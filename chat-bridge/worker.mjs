import { handleRequest } from "./handler.mjs";

export default {
	async fetch(request, env, ctx) {
		return handleRequest(request, env, ctx);
	},
};
