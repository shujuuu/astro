import type {
	SSRResult,
	TransitionAnimation,
	TransitionAnimationPair,
	TransitionAnimationValue,
	TransitionDirectionalAnimations,
} from '../../@types/astro.js';
import { fade, slide } from '../../transitions/index.js';
import { markHTMLString } from './escape.js';

const transitionNameMap = new WeakMap<SSRResult, number>();
function incrementTransitionNumber(result: SSRResult) {
	let num = 1;
	if (transitionNameMap.has(result)) {
		num = transitionNameMap.get(result)! + 1;
	}
	transitionNameMap.set(result, num);
	return num;
}

export function createTransitionScope(result: SSRResult, hash: string) {
	const num = incrementTransitionNumber(result);
	return `astro-${hash}-${num}`;
}

// Ensure animationName is a valid CSS identifier
function toValidIdent(name: string): string {
	return name.replace(/[^a-zA-Z0-9\-\_]/g, '_').replace(/^\_+|\_+$/g, '');
}

type Entries<T extends Record<string, any>> = Iterable<[keyof T, T[keyof T]]>;

const getAnimations = (name: TransitionAnimationValue) => {
	if (name === 'fade') return fade();
	if (name === 'slide') return slide();
	if (typeof name === 'object') return name;
};

const addPairs = (
	animations: TransitionDirectionalAnimations | Record<string, TransitionAnimationPair>,
	stylesheet: ViewTransitionStyleSheet
) => {
	for (const [direction, images] of Object.entries(animations) as Entries<typeof animations>) {
		for (const [image, rules] of Object.entries(images) as Entries<
			(typeof animations)[typeof direction]
		>) {
			stylesheet.addAnimationPair(direction, image, rules);
		}
	}
};

export function renderTransition(
	result: SSRResult,
	hash: string,
	animationName: TransitionAnimationValue | undefined,
	transitionName: string
) {
	// Default to `fade` (similar to `initial`, but snappier)
	if (!animationName) animationName = 'fade';
	const scope = createTransitionScope(result, hash);
	const name = transitionName ? toValidIdent(transitionName) : scope;
	const sheet = new ViewTransitionStyleSheet(scope, name);

	const animations = getAnimations(animationName);
	if (animations) {
		addPairs(animations, sheet);
	} else if (animationName === 'none') {
		sheet.addFallback('old', 'animation: none; mix-blend-mode: normal;');
		sheet.addModern('old', 'animation: none; opacity: 0; mix-blend-mode: normal;');
		sheet.addAnimationRaw('new', 'animation: none; mix-blend-mode: normal;');
	}

	result._metadata.extraHead.push(markHTMLString(`<style>${sheet.toString()}</style>`));
	return scope;
}

export function createAnimationScope(
	transitionName: string,
	animations: Record<string, TransitionAnimationPair>
) {
	const hash = Math.random().toString(36).slice(2, 8);
	const scope = `astro-${hash}`;
	const sheet = new ViewTransitionStyleSheet(scope, transitionName);

	addPairs(animations, sheet);

	return { scope, styles: sheet.toString().replaceAll('"', '') };
}

class ViewTransitionStyleSheet {
	private modern: string[] = [];
	private fallback: string[] = [];

	constructor(
		private scope: string,
		private name: string
	) {}

	toString() {
		const { scope, name } = this;
		const [modern, fallback] = [this.modern, this.fallback].map((rules) => rules.join(''));
		return [
			`[data-astro-transition-scope="${scope}"] { view-transition-name: ${name}; }`,
			this.layer(modern),
			fallback,
		].join('');
	}

	private layer(cssText: string) {
		return cssText ? `@layer astro { ${cssText} }` : '';
	}

	private addRule(target: 'modern' | 'fallback', cssText: string) {
		this[target].push(cssText);
	}

	addAnimationRaw(image: 'old' | 'new' | 'group', animation: string) {
		this.addModern(image, animation);
		this.addFallback(image, animation);
	}

	addModern(image: 'old' | 'new' | 'group', animation: string) {
		const { name } = this;
		this.addRule('modern', `::view-transition-${image}(${name}) { ${animation} }`);
	}

	addFallback(image: 'old' | 'new' | 'group', animation: string) {
		const { scope } = this;
		this.addRule(
			'fallback',
			// Two selectors here, the second in case there is an animation on the root.
			`[data-astro-transition-fallback="${image}"] [data-astro-transition-scope="${scope}"],
			[data-astro-transition-fallback="${image}"][data-astro-transition-scope="${scope}"] { ${animation} }`
		);
	}

	addAnimationPair(
		direction: 'forwards' | 'backwards' | string,
		image: 'old' | 'new',
		rules: TransitionAnimation | TransitionAnimation[]
	) {
		const { scope, name } = this;
		const animation = stringifyAnimation(rules);
		const prefix =
			direction === 'backwards'
				? `[data-astro-transition=back]`
				: direction === 'forwards'
					? ''
					: `[data-astro-transition=${direction}]`;
		this.addRule('modern', `${prefix}::view-transition-${image}(${name}) { ${animation} }`);
		this.addRule(
			'fallback',
			`${prefix}[data-astro-transition-fallback="${image}"] [data-astro-transition-scope="${scope}"],
			${prefix}[data-astro-transition-fallback="${image}"][data-astro-transition-scope="${scope}"] { ${animation} }`
		);
	}
}

type AnimationBuilder = {
	toString(): string;
	[key: string]: string[] | ((k: string) => string);
};

function addAnimationProperty(builder: AnimationBuilder, prop: string, value: string | number) {
	let arr = builder[prop];
	if (Array.isArray(arr)) {
		arr.push(value.toString());
	} else {
		builder[prop] = [value.toString()];
	}
}

function animationBuilder(): AnimationBuilder {
	return {
		toString() {
			let out = '';
			for (let k in this) {
				let value = this[k];
				if (Array.isArray(value)) {
					out += `\n\t${k}: ${value.join(', ')};`;
				}
			}
			return out;
		},
	};
}

function stringifyAnimation(anim: TransitionAnimation | TransitionAnimation[]): string {
	if (Array.isArray(anim)) {
		return stringifyAnimations(anim);
	} else {
		return stringifyAnimations([anim]);
	}
}

function stringifyAnimations(anims: TransitionAnimation[]): string {
	const builder = animationBuilder();

	for (const anim of anims) {
		if (anim.duration) {
			addAnimationProperty(builder, 'animation-duration', toTimeValue(anim.duration));
		}
		if (anim.easing) {
			addAnimationProperty(builder, 'animation-timing-function', anim.easing);
		}
		if (anim.direction) {
			addAnimationProperty(builder, 'animation-direction', anim.direction);
		}
		if (anim.delay) {
			addAnimationProperty(builder, 'animation-delay', anim.delay);
		}
		if (anim.fillMode) {
			addAnimationProperty(builder, 'animation-fill-mode', anim.fillMode);
		}
		addAnimationProperty(builder, 'animation-name', anim.name);
	}

	return builder.toString();
}

function toTimeValue(num: number | string) {
	return typeof num === 'number' ? num + 'ms' : num;
}
