<script lang="ts">
import { useChatMediaRetry } from "./chatMediaRetry";

interface Props {
	src: string;
	alt: string;
	title?: string;
	class?: string;
	loading?: "lazy" | "eager";
}

const { src, alt, title, class: className, loading = "eager" }: Props = $props();
let attempt = $state(0);
const retry = useChatMediaRetry(() => { attempt += 1; });
</script>

{#key attempt}
  <img {src} {alt} {title} {loading} decoding="async" class={className} onload={retry.clear} onerror={retry.fail} />
{/key}
