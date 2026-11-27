/** A server clock anchored to monotonic time, independent of local wall-clock changes. */
export class MusicClock {
	private anchorServer = 0;
	private anchorLocal = 0;
	private samples: { offset: number; rtt: number; at: number }[] = [];
	private initialized = false;
	constructor(
		private readonly monotonic: () => number = () => performance.now(),
	) {}
	now(): number {
		return this.initialized
			? this.anchorServer + this.monotonic() - this.anchorLocal
			: Date.now();
	}
	seed(serverTime: number): void {
		if (this.initialized || !Number.isFinite(serverTime)) return;
		this.anchorServer = serverTime;
		this.anchorLocal = this.monotonic();
		this.initialized = true;
	}
	resetSamples(): void {
		this.samples = [];
	}
	sample(serverTime: number, sentAt: number): boolean {
		const now = this.monotonic();
		const rtt = now - sentAt;
		if (!Number.isFinite(serverTime) || rtt < 0 || rtt > 2000) return false;
		this.samples = this.samples.filter((sample) => now - sample.at < 60_000);
		this.samples.push({
			offset: serverTime - (sentAt + now) / 2,
			rtt,
			at: now,
		});
		this.samples = this.samples.slice(-12);
		const sorted = [...this.samples].sort((a, b) => a.rtt - b.rtt);
		const best = sorted
			.filter((sample) => sample.rtt <= sorted[0].rtt + 50)
			.slice(0, 3);
		const offsets = best.map((sample) => sample.offset).sort((a, b) => a - b);
		this.anchorLocal = now;
		this.anchorServer = now + offsets[Math.floor(offsets.length / 2)];
		this.initialized = true;
		return true;
	}
}
