import type { ComponentInstance, EndpointHandler, MiddlewareHandler } from '../@types/astro.js';
import { callEndpoint, createAPIContext } from './endpoint/index.js';
import { callMiddleware } from './middleware/callMiddleware.js';
import { renderPage } from './render/core.js';
import { type Environment, type RenderContext } from './render/index.js';

type EndpointResultHandler = (
	originalRequest: Request,
	result: Response
) => Promise<Response> | Response;

type PipelineHooks = {
	before: PipelineHookFunction[];
};

export type PipelineHookFunction = (ctx: RenderContext, mod: ComponentInstance | undefined) => void;

/**
 * This is the basic class of a pipeline.
 *
 * Check the {@link ./README.md|README} for more information about the pipeline.
 */
export class Pipeline {
	env: Environment;
	#onRequest?: MiddlewareHandler;
	#hooks: PipelineHooks = {
		before: [],
	};
	/**
	 * The handler accepts the *original* `Request` and result returned by the endpoint.
	 * It must return a `Response`.
	 */
	#endpointHandler?: EndpointResultHandler;

	/**
	 * When creating a pipeline, an environment is mandatory.
	 * The environment won't change for the whole lifetime of the pipeline.
	 */
	constructor(env: Environment) {
		this.env = env;
	}

	setEnvironment() {}

	/**
	 * When rendering a route, an "endpoint" will a type that needs to be handled and transformed into a `Response`.
	 *
	 * Each consumer might have different needs; use this function to set up the handler.
	 */
	setEndpointHandler(handler: EndpointResultHandler) {
		this.#endpointHandler = handler;
	}

	/**
	 * A middleware function that will be called before each request.
	 */
	setMiddlewareFunction(onRequest: MiddlewareHandler) {
		this.#onRequest = onRequest;
	}

	/**
	 * Removes the current middleware function. Subsequent requests won't trigger any middleware.
	 */
	unsetMiddlewareFunction() {
		this.#onRequest = undefined;
	}
	/**
	 * Returns the current environment
	 */
	getEnvironment(): Readonly<Environment> {
		return this.env;
	}

	/**
	 * The main function of the pipeline. Use this function to render any route known to Astro;
	 */
	async renderRoute(
		renderContext: RenderContext,
		componentInstance: ComponentInstance | undefined
	): Promise<Response> {
		for (const hook of this.#hooks.before) {
			hook(renderContext, componentInstance);
		}
		const result = await this.#tryRenderRoute(
			renderContext,
			this.env,
			componentInstance,
			this.#onRequest
		);
		if (renderContext.route.type === 'endpoint') {
			if (!this.#endpointHandler) {
				throw new Error(
					'You created a pipeline that does not know how to handle the result coming from an endpoint.'
				);
			}
			return this.#endpointHandler(renderContext.request, result);
		} else {
			return result;
		}
	}

	/**
	 * It attempts to render a route. A route can be a:
	 * - page
	 * - redirect
	 * - endpoint
	 *
	 * ## Errors
	 *
	 * It throws an error if the page can't be rendered.
	 */
	async #tryRenderRoute(
		renderContext: Readonly<RenderContext>,
		env: Readonly<Environment>,
		mod: Readonly<ComponentInstance> | undefined,
		onRequest?: MiddlewareHandler
	): Promise<Response> {
		const apiContext = createAPIContext({
			request: renderContext.request,
			params: renderContext.params,
			props: renderContext.props,
			site: env.site,
			adapterName: env.adapterName,
			locales: renderContext.locales,
			routingStrategy: renderContext.routing,
			defaultLocale: renderContext.defaultLocale,
		});

		switch (renderContext.route.type) {
			case 'page':
			case 'fallback':
			case 'redirect': {
				if (onRequest) {
					return await callMiddleware(onRequest, apiContext, () => {
						return renderPage({
							mod,
							renderContext,
							env,
							cookies: apiContext.cookies,
						});
					});
				} else {
					return await renderPage({
						mod,
						renderContext,
						env,
						cookies: apiContext.cookies,
					});
				}
			}
			case 'endpoint': {
				return await callEndpoint(mod as any as EndpointHandler, env, renderContext, onRequest);
			}
			default:
				throw new Error(`Couldn't find route of type [${renderContext.route.type}]`);
		}
	}

	/**
	 * Store a function that will be called before starting the rendering phase.
	 * @param fn
	 */
	onBeforeRenderRoute(fn: PipelineHookFunction) {
		this.#hooks.before.push(fn);
	}
}
