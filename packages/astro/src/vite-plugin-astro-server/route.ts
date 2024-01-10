import type http from 'node:http';
import { fileURLToPath } from 'node:url';
import type {
	ComponentInstance,
	DevOverlayMetadata,
	ManifestData,
	MiddlewareHandler,
	RouteData,
	SSRElement,
	SSRManifest,
} from '../@types/astro.js';
import { getInfoOutput } from '../cli/info/index.js';
import { ASTRO_VERSION } from '../core/constants.js';
import { AstroErrorData, isAstroError } from '../core/errors/index.js';
import { req } from '../core/messages.js';
import { sequence } from '../core/middleware/index.js';
import { loadMiddleware } from '../core/middleware/loadMiddleware.js';
import {
	createRenderContext,
	getParamsAndProps,
	type RenderContext,
	type SSROptions,
} from '../core/render/index.js';
import { createRequest } from '../core/request.js';
import { matchAllRoutes } from '../core/routing/index.js';
import { isPage, resolveIdToUrl } from '../core/util.js';
import { createI18nMiddleware, i18nPipelineHook } from '../i18n/middleware.js';
import { getSortedPreloadedMatches } from '../prerender/routing.js';
import { isServerLikeOutput } from '../prerender/utils.js';
import { PAGE_SCRIPT_ID } from '../vite-plugin-scripts/index.js';
import { getStylesForURL } from './css.js';
import type DevPipeline from './devPipeline.js';
import { preload } from './index.js';
import { getComponentMetadata } from './metadata.js';
import { handle404Response, writeSSRResult, writeWebResponse } from './response.js';
import { getScriptsForURL } from './scripts.js';
import { normalizeTheLocale } from '../i18n/index.js';

const clientLocalsSymbol = Symbol.for('astro.locals');

type AsyncReturnType<T extends (...args: any) => Promise<any>> = T extends (
	...args: any
) => Promise<infer R>
	? R
	: any;

export interface MatchedRoute {
	route: RouteData;
	filePath: URL;
	resolvedPathname: string;
	preloadedComponent: ComponentInstance;
	mod: ComponentInstance;
}

function isLoggedRequest(url: string) {
	return url !== '/favicon.ico';
}

function getCustom404Route(manifestData: ManifestData): RouteData | undefined {
	const route404 = /^\/404\/?$/;
	return manifestData.routes.find((r) => route404.test(r.route));
}

export async function matchRoute(
	pathname: string,
	manifestData: ManifestData,
	pipeline: DevPipeline
): Promise<MatchedRoute | undefined> {
	const env = pipeline.getEnvironment();
	const { routeCache, logger } = env;
	let matches = matchAllRoutes(pathname, manifestData);

	const preloadedMatches = await getSortedPreloadedMatches({
		pipeline,
		matches,
		settings: pipeline.getSettings(),
	});

	for await (const { preloadedComponent, route: maybeRoute, filePath } of preloadedMatches) {
		// attempt to get static paths
		// if this fails, we have a bad URL match!
		try {
			await getParamsAndProps({
				mod: preloadedComponent,
				route: maybeRoute,
				routeCache,
				pathname: pathname,
				logger,
				ssr: isServerLikeOutput(pipeline.getConfig()),
			});
			return {
				route: maybeRoute,
				filePath,
				resolvedPathname: pathname,
				preloadedComponent,
				mod: preloadedComponent,
			};
		} catch (e) {
			// Ignore error for no matching static paths
			if (isAstroError(e) && e.title === AstroErrorData.NoMatchingStaticPathFound.title) {
				continue;
			}
			throw e;
		}
	}

	// Try without `.html` extensions or `index.html` in request URLs to mimic
	// routing behavior in production builds. This supports both file and directory
	// build formats, and is necessary based on how the manifest tracks build targets.
	const altPathname = pathname.replace(/(index)?\.html$/, '');
	if (altPathname !== pathname) {
		return await matchRoute(altPathname, manifestData, pipeline);
	}

	if (matches.length) {
		const possibleRoutes = matches.flatMap((route) => route.component);

		pipeline.logger.warn(
			'router',
			`${AstroErrorData.NoMatchingStaticPathFound.message(
				pathname
			)}\n\n${AstroErrorData.NoMatchingStaticPathFound.hint(possibleRoutes)}`
		);
	}

	const custom404 = getCustom404Route(manifestData);

	if (custom404) {
		const filePath = new URL(`./${custom404.component}`, pipeline.getConfig().root);
		const preloadedComponent = await preload({ pipeline, filePath });

		return {
			route: custom404,
			filePath,
			resolvedPathname: pathname,
			preloadedComponent,
			mod: preloadedComponent,
		};
	}

	return undefined;
}

type HandleRoute = {
	matchedRoute: AsyncReturnType<typeof matchRoute>;
	url: URL;
	pathname: string;
	body: ArrayBuffer | undefined;
	origin: string;
	manifestData: ManifestData;
	incomingRequest: http.IncomingMessage;
	incomingResponse: http.ServerResponse;
	manifest: SSRManifest;
	status?: 404 | 500;
	pipeline: DevPipeline;
};

export async function handleRoute({
	matchedRoute,
	url,
	pathname,
	status = getStatus(matchedRoute),
	body,
	origin,
	pipeline,
	manifestData,
	incomingRequest,
	incomingResponse,
	manifest,
}: HandleRoute): Promise<void> {
	const timeStart = performance.now();
	const env = pipeline.getEnvironment();
	const config = pipeline.getConfig();
	const moduleLoader = pipeline.getModuleLoader();
	const { logger } = env;
	if (!matchedRoute && !config.i18n) {
		if (isLoggedRequest(pathname)) {
			logger.info(null, req({ url: pathname, method: incomingRequest.method, statusCode: 404 }));
		}
		return handle404Response(origin, incomingRequest, incomingResponse);
	}

	const buildingToSSR = isServerLikeOutput(config);

	let request: Request;
	let renderContext: RenderContext;
	let mod: ComponentInstance | undefined = undefined;
	let options: SSROptions | undefined = undefined;
	let route: RouteData;
	const middleware = await loadMiddleware(moduleLoader);

	if (!matchedRoute) {
		if (config.i18n) {
			const locales = config.i18n.locales;
			const pathNameHasLocale = pathname
				.split('/')
				.filter(Boolean)
				.some((segment) => {
					let found = false;
					for (const locale of locales) {
						if (typeof locale === 'string') {
							if (normalizeTheLocale(locale) === normalizeTheLocale(segment)) {
								found = true;
								break;
							}
						} else {
							if (locale.path === segment) {
								found = true;
								break;
							}
						}
					}
					return found;
				});
			// Even when we have `config.base`, the pathname is still `/` because it gets stripped before
			if (!pathNameHasLocale && pathname !== '/') {
				return handle404Response(origin, incomingRequest, incomingResponse);
			}
			request = createRequest({
				url,
				headers: buildingToSSR ? incomingRequest.headers : new Headers(),
				logger,
				ssr: buildingToSSR,
			});
			route = {
				component: '',
				generate(_data: any): string {
					return '';
				},
				params: [],
				pattern: new RegExp(''),
				prerender: false,
				segments: [],
				type: 'fallback',
				route: '',
				fallbackRoutes: [],
			};
			renderContext = await createRenderContext({
				request,
				pathname,
				env,
				mod,
				route,
				locales: manifest.i18n?.locales,
				routing: manifest.i18n?.routing,
				defaultLocale: manifest.i18n?.defaultLocale,
			});
		} else {
			return handle404Response(origin, incomingRequest, incomingResponse);
		}
	} else {
		const filePath: URL | undefined = matchedRoute.filePath;
		const { preloadedComponent } = matchedRoute;
		route = matchedRoute.route;
		// Headers are only available when using SSR.
		request = createRequest({
			url,
			headers: buildingToSSR ? incomingRequest.headers : new Headers(),
			method: incomingRequest.method,
			body,
			logger,
			ssr: buildingToSSR,
			clientAddress: buildingToSSR ? incomingRequest.socket.remoteAddress : undefined,
			locals: Reflect.get(incomingRequest, clientLocalsSymbol), // Allows adapters to pass in locals in dev mode.
		});

		// Set user specified headers to response object.
		for (const [name, value] of Object.entries(config.server.headers ?? {})) {
			if (value) incomingResponse.setHeader(name, value);
		}

		options = {
			env,
			filePath,
			preload: preloadedComponent,
			pathname,
			request,
			route,
		};
		if (middleware) {
			options.middleware = middleware;
		}

		mod = options.preload;

		const { scripts, links, styles, metadata } = await getScriptsAndStyles({
			pipeline,
			filePath: options.filePath,
		});

		const i18n = pipeline.getConfig().i18n;

		renderContext = await createRenderContext({
			request: options.request,
			pathname: options.pathname,
			scripts,
			links,
			styles,
			componentMetadata: metadata,
			route: options.route,
			mod,
			env,
			locales: i18n?.locales,
			routing: i18n?.routing,
			defaultLocale: i18n?.defaultLocale,
		});
	}

	const onRequest = middleware?.onRequest as MiddlewareHandler | undefined;
	if (config.i18n) {
		const i18Middleware = createI18nMiddleware(config.i18n, config.base, config.trailingSlash);

		if (i18Middleware) {
			if (onRequest) {
				pipeline.setMiddlewareFunction(sequence(i18Middleware, onRequest));
			} else {
				pipeline.setMiddlewareFunction(i18Middleware);
			}
			pipeline.onBeforeRenderRoute(i18nPipelineHook);
		} else if (onRequest) {
			pipeline.setMiddlewareFunction(onRequest);
		}
	} else if (onRequest) {
		pipeline.setMiddlewareFunction(onRequest);
	}

	let response = await pipeline.renderRoute(renderContext, mod);
	if (isLoggedRequest(pathname)) {
		const timeEnd = performance.now();
		logger.info(
			null,
			req({
				url: pathname,
				method: incomingRequest.method,
				statusCode: status ?? response.status,
				reqTime: timeEnd - timeStart,
			})
		);
	}
	if (response.status === 404 && has404Route(manifestData)) {
		const fourOhFourRoute = await matchRoute('/404', manifestData, pipeline);
		if (options && fourOhFourRoute?.route !== options.route)
			return handleRoute({
				...options,
				matchedRoute: fourOhFourRoute,
				url: new URL(pathname, url),
				status: 404,
				body,
				origin,
				pipeline,
				manifestData,
				incomingRequest,
				incomingResponse,
				manifest,
			});
	}
	if (route.type === 'endpoint') {
		await writeWebResponse(incomingResponse, response);
		return;
	}
	// We are in a recursion, and it's possible that this function is called itself with a status code
	// By default, the status code passed via parameters is computed by the matched route.
	//
	// By default, we should give priority to the status code passed, although it's possible that
	// the `Response` emitted by the user is a redirect. If so, then return the returned response.
	if (response.status < 400 && response.status >= 300) {
		await writeSSRResult(request, response, incomingResponse);
		return;
	}
	// Apply the `status` override to the response object before responding.
	// Response.status is read-only, so a clone is required to override.
	if (status && response.status !== status && (status === 404 || status === 500)) {
		response = new Response(response.body, {
			status: status,
			headers: response.headers,
		});
	}
	await writeSSRResult(request, response, incomingResponse);
}

interface GetScriptsAndStylesParams {
	pipeline: DevPipeline;
	filePath: URL;
}

async function getScriptsAndStyles({ pipeline, filePath }: GetScriptsAndStylesParams) {
	const moduleLoader = pipeline.getModuleLoader();
	const settings = pipeline.getSettings();
	const mode = pipeline.getEnvironment().mode;
	// Add hoisted script tags
	const scripts = await getScriptsForURL(filePath, settings.config.root, moduleLoader);

	// Inject HMR scripts
	if (isPage(filePath, settings) && mode === 'development') {
		scripts.add({
			props: { type: 'module', src: '/@vite/client' },
			children: '',
		});

		if (
			settings.config.devToolbar.enabled &&
			(await settings.preferences.get('devToolbar.enabled'))
		) {
			scripts.add({
				props: {
					type: 'module',
					src: await resolveIdToUrl(moduleLoader, 'astro/runtime/client/dev-overlay/entrypoint.js'),
				},
				children: '',
			});

			const additionalMetadata: DevOverlayMetadata['__astro_dev_overlay__'] = {
				root: fileURLToPath(settings.config.root),
				version: ASTRO_VERSION,
				debugInfo: await getInfoOutput({ userConfig: settings.config, print: false }),
			};

			// Additional data for the dev overlay
			scripts.add({
				props: {},
				children: `window.__astro_dev_overlay__ = ${JSON.stringify(additionalMetadata)}`,
			});
		}
	}

	// TODO: We should allow adding generic HTML elements to the head, not just scripts
	for (const script of settings.scripts) {
		if (script.stage === 'head-inline') {
			scripts.add({
				props: {},
				children: script.content,
			});
		} else if (script.stage === 'page' && isPage(filePath, settings)) {
			scripts.add({
				props: { type: 'module', src: `/@id/${PAGE_SCRIPT_ID}` },
				children: '',
			});
		}
	}

	// Pass framework CSS in as style tags to be appended to the page.
	const { urls: styleUrls, styles: importedStyles } = await getStylesForURL(filePath, moduleLoader);
	let links = new Set<SSRElement>();
	[...styleUrls].forEach((href) => {
		links.add({
			props: {
				rel: 'stylesheet',
				href,
			},
			children: '',
		});
	});

	let styles = new Set<SSRElement>();
	importedStyles.forEach(({ id, url, content }) => {
		// Vite handles HMR for styles injected as scripts
		scripts.add({
			props: {
				type: 'module',
				src: url,
			},
			children: '',
		});
		// But we still want to inject the styles to avoid FOUC. The style tags
		// should emulate what Vite injects so further HMR works as expected.
		styles.add({
			props: {
				'data-vite-dev-id': id,
			},
			children: content,
		});
	});

	const metadata = await getComponentMetadata(filePath, moduleLoader);

	return { scripts, styles, links, metadata };
}

function getStatus(matchedRoute?: MatchedRoute): 404 | 500 | undefined {
	if (!matchedRoute) return 404;
	if (matchedRoute.route.route === '/404') return 404;
	if (matchedRoute.route.route === '/500') return 500;
}

function has404Route(manifest: ManifestData): boolean {
	return manifest.routes.some((route) => route.route === '/404');
}
