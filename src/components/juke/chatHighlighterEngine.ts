// 独立的代码高亮引擎（通过 Dynamic Import 懒加载）
// 基于 highlight.js/lib/core，仅按需打包 21 种最常用主流开发语言，体积控制在最小

import hljs from "highlight.js/lib/core";

// 常见 21 种主流语言按需加载
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

// 轻量路径保护：修补官方 PowerShell 语法缺少路径匹配导致路径连字符被切碎的缺陷
function safePowershell(api: Parameters<typeof powershell>[0]) {
	const def = powershell(api);
	def.contains.unshift({
		className: "string",
		begin:
			/(?:https?:\/\/|[a-zA-Z]:[\\/]|(?:\.{1,2}|~)[\\/]|(?:[\w.-]+[\\/])+[\w.-]+|\b[\w.-]+\.(?:ps1|psm1|sh|py|js|ts|json|yml|yaml|md|txt|exe)\b)/,
	});
	return def;
}

// 注册语言
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("scss", scss);
hljs.registerLanguage("json", json);
hljs.registerLanguage("python", python);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("powershell", safePowershell);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("c", c);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("java", java);
hljs.registerLanguage("go", go);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("dockerfile", dockerfile);

// 语言别名表
const ALIASES: Record<string, string> = {
	js: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	jsx: "javascript",
	ts: "typescript",
	mts: "typescript",
	cts: "typescript",
	tsx: "typescript",
	py: "python",
	py3: "python",
	sh: "bash",
	shell: "bash",
	zsh: "bash",
	console: "bash",
	terminal: "bash",
	ps: "powershell",
	ps1: "powershell",
	pwsh: "powershell",
	htm: "xml",
	xhtml: "xml",
	svg: "xml",
	vue: "xml",
	svelte: "xml",
	sass: "scss",
	less: "css",
	jsonc: "json",
	mysql: "sql",
	pgsql: "sql",
	postgres: "sql",
	rs: "rust",
	golang: "go",
	h: "c",
	hpp: "cpp",
	"c++": "cpp",
	cc: "cpp",
	cs: "csharp",
	kt: "java",
	kotlin: "java",
	yml: "yaml",
	md: "markdown",
	toml: "ini",
	conf: "ini",
	docker: "dockerfile",
};

export interface HighlightResult {
	html: string;
	detectedLang: string;
}

export function highlightCode(code: string, rawLang = ""): HighlightResult {
	if (!code) {
		return { html: "", detectedLang: "plaintext" };
	}

	const normalized = rawLang.trim().toLowerCase();
	const targetLang = ALIASES[normalized] || normalized;

	// 1. 如果明确指定了语言且该语言已注册
	if (targetLang && hljs.getLanguage(targetLang)) {
		try {
			const res = hljs.highlight(code, {
				language: targetLang,
				ignoreIllegals: true,
			});
			return {
				html: res.value,
				detectedLang: targetLang,
			};
		} catch {
			// 异常降级
		}
	}

	// 2. 如果未指定语言，或者指定未知语言，使用 highlight.js 自动智能探测（限制在注册的核心语言内）
	try {
		const autoRes = hljs.highlightAuto(code);
		return {
			html: autoRes.value,
			detectedLang: autoRes.language || targetLang || "code",
		};
	} catch {
		return {
			html: escapeHtml(code),
			detectedLang: targetLang || "code",
		};
	}
}

export function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
