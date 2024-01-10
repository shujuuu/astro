import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { Connect, Plugin } from 'vite';
import type { AstroSettings } from '../../@types/astro.js';
import { notFoundTemplate, subpathNotUsedTemplate } from '../../template/4xx.js';
import { cleanUrl } from '../../vite-plugin-utils/index.js';
import { stripBase } from './util.js';

const HAS_FILE_EXTENSION_REGEXP = /^.*\.[^\\]+$/;

export function vitePluginAstroPreview(settings: AstroSettings): Plugin {
	const { base, outDir, trailingSlash } = settings.config;

	return {
		name: 'astro:preview',
		apply: 'serve',
		configurePreviewServer(server) {
			server.middlewares.use((req, res, next) => {
				// respond 404 to requests outside the base request directory
				if (!req.url!.startsWith(base)) {
					res.statusCode = 404;
					res.end(subpathNotUsedTemplate(base, req.url!));
					return;
				}

				const pathname = cleanUrl(stripBase(req.url!, base));
				const isRoot = pathname === '/';

				// Validate trailingSlash
				if (!isRoot) {
					const hasTrailingSlash = pathname.endsWith('/');

					if (hasTrailingSlash && trailingSlash == 'never') {
						res.statusCode = 404;
						res.end(notFoundTemplate(pathname, 'Not Found (trailingSlash is set to "never")'));
						return;
					}

					if (
						!hasTrailingSlash &&
						trailingSlash == 'always' &&
						!HAS_FILE_EXTENSION_REGEXP.test(pathname)
					) {
						res.statusCode = 404;
						res.end(notFoundTemplate(pathname, 'Not Found (trailingSlash is set to "always")'));
						return;
					}
				}

				next();
			});

			return () => {
				// NOTE: the `base` is stripped from `req.url` for post middlewares

				server.middlewares.use((req, res, next) => {
					const pathname = cleanUrl(req.url!);

					// Vite doesn't handle /foo/ if /foo.html exists, we handle it anyways
					if (pathname.endsWith('/')) {
						const pathnameWithoutSlash = pathname.slice(0, -1);
						const htmlPath = fileURLToPath(outDir + pathnameWithoutSlash + '.html');
						if (fs.existsSync(htmlPath)) {
							req.url = pathnameWithoutSlash + '.html';
							return next();
						}
					}
					// Vite doesn't handle /foo if /foo/index.html exists, we handle it anyways
					else {
						const htmlPath = fileURLToPath(outDir + pathname + '/index.html');
						if (fs.existsSync(htmlPath)) {
							req.url = pathname + '/index.html';
							return next();
						}
					}

					next();
				});

				// Vite has its own 404 middleware, we replace it with ours instead.
				for (const middleware of server.middlewares.stack) {
					// This hardcoded name will not break between Vite versions
					if ((middleware.handle as Connect.HandleFunction).name === 'vite404Middleware') {
						// Fallback to 404 page if it exists
						middleware.handle = (req: IncomingMessage, res: ServerResponse) => {
							const errorPagePath = fileURLToPath(outDir + '/404.html');
							if (fs.existsSync(errorPagePath)) {
								res.statusCode = 404;
								res.setHeader('Content-Type', 'text/html;charset=utf-8');
								res.end(fs.readFileSync(errorPagePath));
							} else {
								res.statusCode = 404;
								res.end(notFoundTemplate(req.url!, 'Not Found'));
							}
						};
					}
				}
			};
		},
	};
}
