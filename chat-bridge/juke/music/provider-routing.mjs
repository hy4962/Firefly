const SECONDARY_START_MS = 450;
const PRIORITY_WAIT_MS = 350;

export function lookupPreferredProviders(providers, lookup, budgetMs, alternativeLimit = 3) {
  return new Promise(resolve => {
    const controller = new AbortController();
    const results = Array(providers.length).fill(null);
    let startedSecondaries = false;
    let finished = false;
    let priorityTimer;
    const fallbackTimer = setTimeout(startSecondaries, SECONDARY_START_MS);
    const deadlineTimer = setTimeout(() => finish(true), budgetMs);

    function finish(timedOut = false) {
      if (finished) return;
      finished = true;
      clearTimeout(fallbackTimer);
      clearTimeout(deadlineTimer);
      clearTimeout(priorityTimer);
      controller.abort();
      const winner = results.find(result => result?.playable);
      if (winner) {
        resolve(winner);
        return;
      }
      const choices = new Map();
      for (const option of results.flatMap(result => result?.alternatives || [])) {
        if (!choices.has(option.track.id)) choices.set(option.track.id, option);
      }
      const order = ['same_artist_version', 'same_title', 'same_artist_other'];
      const alternatives = [...choices.values()]
        .sort((a, b) => order.indexOf(a.relation) - order.indexOf(b.relation)).slice(0, alternativeLimit);
      resolve({ alternatives, temporaryFailure: timedOut || results.some(result => result?.temporaryFailure) });
    }

    function startSecondaries() {
      if (startedSecondaries || finished) return;
      startedSecondaries = true;
      for (let index = 1; index < providers.length; index++) start(index);
    }

    async function start(index) {
      try {
        results[index] = await lookup(providers[index], controller.signal);
      } catch {
        results[index] = { temporaryFailure: true };
      }
      if (finished) return;
      const winner = results.findIndex(result => result?.playable);
      if (winner >= 0) {
        if (results.slice(0, winner).every(Boolean)) finish();
        else priorityTimer ??= setTimeout(finish, PRIORITY_WAIT_MS);
      } else {
        if (index === 0) startSecondaries();
        if (results.every(Boolean)) finish();
      }
    }

    void start(0);
  });
}
