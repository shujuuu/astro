import type { AstroCookies, ComponentInstance } from '../../@types/astro.js';
import { renderPage as runtimeRenderPage } from '../../runtime/server/index.js';
import { attachCookiesToResponse } from '../cookies/index.js';
import { CantRenderPage } from '../errors/errors-data.js';
import { AstroError } from '../errors/index.js';
import { routeIsFallback } from '../redirects/helpers.js';
import { redirectRouteGenerate, redirectRouteStatus, routeIsRedirect } from '../redirects/index.js';
import type { RenderContext } from './context.js';
import type { Environment } from './environment.js';
import { createResult } from './result.js';

export type RenderPage = {
	mod: ComponentInstance | undefined;
	renderContext: RenderContext;
	env: Environment;
	cookies: AstroCookies;
};

export async function renderPage({ mod, renderContext, env, cookies }: RenderPage) {
	if (routeIsRedirect(renderContext.route)) {
		return new Response(null, {
			status: redirectRouteStatus(renderContext.route, renderContext.request.method),
			headers: {
				location: redirectRouteGenerate(renderContext.route, renderContext.params),
			},
		});
	} else if (routeIsFallback(renderContext.route)) {
		// We return a 404 because fallback routes don't exist.
		// It's responsibility of the middleware to catch them and re-route the requests
		return new Response(null, {
			status: 404,
		});
	} else if (!mod) {
		throw new AstroError(CantRenderPage);
	}

	// Validate the page component before rendering the page
	const Component = mod.default;
	if (!Component)
		throw new Error(`Expected an exported Astro component but received typeof ${typeof Component}`);

	const result = createResult({
		adapterName: env.adapterName,
		links: renderContext.links,
		styles: renderContext.styles,
		logger: env.logger,
		params: renderContext.params,
		pathname: renderContext.pathname,
		componentMetadata: renderContext.componentMetadata,
		resolve: env.resolve,
		renderers: env.renderers,
		clientDirectives: env.clientDirectives,
		compressHTML: env.compressHTML,
		request: renderContext.request,
		partial: !!mod.partial,
		site: env.site,
		scripts: renderContext.scripts,
		ssr: env.ssr,
		status: renderContext.status ?? 200,
		cookies,
		locals: renderContext.locals ?? {},
		locales: renderContext.locales,
		defaultLocale: renderContext.defaultLocale,
		routingStrategy: renderContext.routing,
	});

	const response = await runtimeRenderPage(
		result,
		Component,
		renderContext.props,
		{},
		env.streaming,
		renderContext.route
	);

	// If there is an Astro.cookies instance, attach it to the response so that
	// adapters can grab the Set-Cookie headers.
	if (result.cookies) {
		attachCookiesToResponse(response, result.cookies);
	}

	return response;
}
