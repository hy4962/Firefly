<script lang="ts">
import { onDestroy } from "svelte";
import { escapeHtml, loadChatHighlighter } from "./chatHighlighterLoader";

interface Props {
	code: string;
	lang?: string;
}

const { code = "", lang = "" }: Props = $props();

const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
	powershell: "PowerShell",
	pwsh: "PowerShell",
	ps1: "PowerShell",
	ps: "PowerShell",
	typescript: "TypeScript",
	ts: "TypeScript",
	javascript: "JavaScript",
	js: "JavaScript",
	jsx: "JSX",
	tsx: "TSX",
	python: "Python",
	py: "Python",
	bash: "Bash",
	sh: "Shell",
	shell: "Shell",
	zsh: "Zsh",
	terminal: "Terminal",
	console: "Console",
	rust: "Rust",
	rs: "Rust",
	go: "Go",
	golang: "Go",
	c: "C",
	cpp: "C++",
	"c++": "C++",
	csharp: "C#",
	cs: "C#",
	java: "Java",
	html: "HTML",
	xml: "XML",
	svg: "SVG",
	css: "CSS",
	scss: "SCSS",
	sass: "Sass",
	less: "Less",
	json: "JSON",
	jsonc: "JSON",
	yaml: "YAML",
	yml: "YAML",
	sql: "SQL",
	markdown: "Markdown",
	md: "Markdown",
	diff: "Diff",
	dockerfile: "Dockerfile",
	docker: "Dockerfile",
	ini: "INI",
	toml: "TOML",
	vue: "Vue",
	svelte: "Svelte",
	graphql: "GraphQL",
	php: "PHP",
	ruby: "Ruby",
	rb: "Ruby",
	swift: "Swift",
	kotlin: "Kotlin",
	kt: "Kotlin",
	dart: "Dart",
	lua: "Lua",
	r: "R",
};

function formatLanguageName(rawLang: string): string {
	const trimmed = rawLang.trim();
	if (!trimmed) return "Code";
	const lower = trimmed.toLowerCase();
	if (LANGUAGE_DISPLAY_NAMES[lower]) {
		return LANGUAGE_DISPLAY_NAMES[lower];
	}
	return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

let copied = $state(false);
let copyTimer: number | null = null;

// 初始立即展示安全转义后的代码文本，确保渲染 0 延迟
let highlightedHtml = $state(escapeHtml(code));
let resolvedLang = $state(lang.trim());

const displayLang = $derived(formatLanguageName(resolvedLang || lang));

// 动态懒加载：仅当该代码块被挂载显示时，才会异步拉取 highlight.js 引擎分包
$effect(() => {
	let active = true;
	const currentCode = code;
	const currentLang = lang;

	void loadChatHighlighter().then((highlighter) => {
		if (!active) return;
		const res = highlighter.highlightCode(currentCode, currentLang);
		highlightedHtml = res.html;
		if (res.detectedLang && res.detectedLang !== "plaintext") {
			resolvedLang = res.detectedLang;
		}
	});

	return () => {
		active = false;
	};
});

async function handleCopy(e: MouseEvent) {
	e.stopPropagation();
	if (!code) return;

	try {
		if (navigator?.clipboard?.writeText) {
			await navigator.clipboard.writeText(code);
		} else {
			fallbackCopyText(code);
		}
		copied = true;
		if (copyTimer !== null) clearTimeout(copyTimer);
		copyTimer = window.setTimeout(() => {
			copied = false;
			copyTimer = null;
		}, 2000);
	} catch {
		fallbackCopyText(code);
		copied = true;
		if (copyTimer !== null) clearTimeout(copyTimer);
		copyTimer = window.setTimeout(() => {
			copied = false;
			copyTimer = null;
		}, 2000);
	}
}

function fallbackCopyText(text: string) {
	const textarea = document.createElement("textarea");
	textarea.value = text;
	textarea.style.position = "fixed";
	textarea.style.top = "0";
	textarea.style.left = "0";
	textarea.style.opacity = "0";
	textarea.style.pointerEvents = "none";
	document.body.appendChild(textarea);
	textarea.focus();
	textarea.select();
	try {
		document.execCommand("copy");
	} finally {
		document.body.removeChild(textarea);
	}
}

onDestroy(() => {
	if (copyTimer !== null) {
		clearTimeout(copyTimer);
		copyTimer = null;
	}
});
</script>

<div class="chat-md-pre-wrap">
  <div class="chat-md-pre-header">
    <div class="chat-md-pre-lang-badge">
      <svg class="chat-md-pre-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="16 18 22 12 16 6"></polyline>
        <polyline points="8 6 2 12 8 18"></polyline>
      </svg>
      <span class="chat-md-pre-lang-text">{displayLang}</span>
    </div>

    <button
      type="button"
      class="chat-md-copy-btn {copied ? 'is-copied' : ''}"
      onclick={handleCopy}
      title={copied ? "已复制到剪贴板" : "复制代码"}
      aria-label="复制代码"
    >
      {#if copied}
        <svg class="chat-md-copy-svg text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span class="chat-md-copy-label text-emerald-400 font-medium">已复制</span>
      {:else}
        <svg class="chat-md-copy-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        <span class="chat-md-copy-label">复制</span>
      {/if}
    </button>
  </div>

  <pre class="chat-md-pre custom-scrollbar"><code class="hljs chat-code-block">{@html highlightedHtml}</code></pre>
</div>
