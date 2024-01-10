import type { GetStaticPathsItem, Params, RouteData } from '../../@types/astro.js';
import { trimSlashes } from '../path.js';
import { validateGetStaticPathsParameter } from './validation.js';

/**
 * given an array of params like `['x', 'y', 'z']` for
 * src/routes/[x]/[y]/[z]/svelte, create a function
 * that turns a RegExpExecArray into ({ x, y, z })
 */
export function getParams(array: string[]) {
	const fn = (match: RegExpExecArray) => {
		const params: Params = {};
		array.forEach((key, i) => {
			if (key.startsWith('...')) {
				params[key.slice(3)] = match[i + 1] ? match[i + 1] : undefined;
			} else {
				params[key] = match[i + 1];
			}
		});
		return params;
	};

	return fn;
}

/**
 * given a route's Params object, validate parameter
 * values and create a stringified key for the route
 * that can be used to match request routes
 */
export function stringifyParams(params: GetStaticPathsItem['params'], route: RouteData) {
	// validate parameter values then stringify each value
	const validatedParams = Object.entries(params).reduce((acc, next) => {
		validateGetStaticPathsParameter(next, route.component);
		const [key, value] = next;
		if (value !== undefined) {
			acc[key] = typeof value === 'string' ? trimSlashes(value) : value.toString();
		}
		return acc;
	}, {} as Params);

	return JSON.stringify(route.generate(validatedParams));
}
