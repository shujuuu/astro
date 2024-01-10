import { expect } from 'chai';
import * as cheerio from 'cheerio';
import { basename } from 'node:path';
import { Writable } from 'node:stream';
import parseSrcset from 'parse-srcset';
import { removeDir } from '../dist/core/fs/index.js';
import { Logger } from '../dist/core/logger/core.js';
import testAdapter from './test-adapter.js';
import { testImageService } from './test-image-service.js';
import { loadFixture } from './test-utils.js';

describe('astro:image', () => {
	/** @type {import('./test-utils').Fixture} */
	let fixture;

	describe('dev', () => {
		/** @type {import('./test-utils').DevServer} */
		let devServer;
		/** @type {Array<{ type: any, level: 'error', message: string; }>} */
		let logs = [];

		before(async () => {
			fixture = await loadFixture({
				root: './fixtures/core-image/',
				image: {
					service: testImageService({ foo: 'bar' }),
					domains: ['avatars.githubusercontent.com'],
				},
			});

			devServer = await fixture.startDevServer({
				logger: new Logger({
					level: 'error',
					dest: new Writable({
						objectMode: true,
						write(event, _, callback) {
							logs.push(event);
							callback();
						},
					}),
				}),
			});
		});

		after(async () => {
			await devServer.stop();
		});

		describe('basics', () => {
			let $;
			before(async () => {
				let res = await fixture.fetch('/');
				let html = await res.text();
				$ = cheerio.load(html);
			});

			it('Adds the <img> tag', () => {
				let $img = $('#local img');
				expect($img).to.have.a.lengthOf(1);
				expect($img.attr('src').startsWith('/_image')).to.equal(true);
			});

			it('includes loading and decoding attributes', () => {
				let $img = $('#local img');
				expect(!!$img.attr('loading')).to.equal(true);
				expect(!!$img.attr('decoding')).to.equal(true);
			});

			it('has width and height - no dimensions set', () => {
				let $img = $('#local img');
				expect($img.attr('width')).to.equal('207');
				expect($img.attr('height')).to.equal('243');
			});

			it('has proper width and height - only width', () => {
				let $img = $('#local-width img');
				expect($img.attr('width')).to.equal('350');
				expect($img.attr('height')).to.equal('411');
			});

			it('has proper width and height - only height', () => {
				let $img = $('#local-height img');
				expect($img.attr('width')).to.equal('170');
				expect($img.attr('height')).to.equal('200');
			});

			it('has proper width and height - has both width and height', () => {
				let $img = $('#local-both img');
				expect($img.attr('width')).to.equal('300');
				expect($img.attr('height')).to.equal('400');
			});

			it('includes the provided alt', () => {
				let $img = $('#local img');
				expect($img.attr('alt')).to.equal('a penguin');
			});

			it('middleware loads the file', async () => {
				let $img = $('#local img');
				let src = $img.attr('src');
				let res = await fixture.fetch(src);
				expect(res.status).to.equal(200);
			});

			it('returns proper content-type', async () => {
				let $img = $('#local img');
				let src = $img.attr('src');
				let res = await fixture.fetch(src);
				expect(res.headers.get('content-type')).to.equal('image/webp');
			});

			it('properly skip processing SVGs, but does not error', async () => {
				let res = await fixture.fetch('/svgSupport');
				let html = await res.text();

				$ = cheerio.load(html);
				let $img = $('img');
				expect($img).to.have.a.lengthOf(1);

				let src = $img.attr('src');
				res = await fixture.fetch(src);
				expect(res.status).to.equal(200);
			});

			it("errors when an ESM imported image's src is passed to Image/getImage instead of the full import", async () => {
				logs.length = 0;
				let res = await fixture.fetch('/error-image-src-passed');
				await res.text();

				expect(logs).to.have.a.lengthOf(1);
				expect(logs[0].message).to.contain('must be an imported image or an URL');
			});

			it('supports images from outside the project', async () => {
				let res = await fixture.fetch('/outsideProject');
				let html = await res.text();
				$ = cheerio.load(html);

				let $img = $('img');
				expect($img).to.have.a.lengthOf(2);
				expect(
					$img.toArray().every((img) => {
						return (
							img.attribs['src'].startsWith('/@fs/') ||
							img.attribs['src'].startsWith('/_image?href=%2F%40fs%2F')
						);
					})
				).to.be.true;
			});

			it('supports inlined imports', async () => {
				let res = await fixture.fetch('/inlineImport');
				let html = await res.text();
				$ = cheerio.load(html);

				let $img = $('img');
				expect($img).to.have.a.lengthOf(1);

				let src = $img.attr('src');
				res = await fixture.fetch(src);
				expect(res.status).to.equal(200);
			});

			it('supports uppercased imports', async () => {
				let res = await fixture.fetch('/uppercase');
				let html = await res.text();
				$ = cheerio.load(html);

				let $img = $('img');
				expect($img).to.have.a.lengthOf(1);

				let src = $img.attr('src');
				let loading = $img.attr('loading');
				res = await fixture.fetch(src);
				expect(res.status).to.equal(200);
				expect(loading).to.not.be.undefined;
			});

			it('supports avif', async () => {
				let res = await fixture.fetch('/avif');
				let html = await res.text();
				$ = cheerio.load(html);

				let $img = $('img');
				expect($img).to.have.a.lengthOf(1);

				let src = $img.attr('src');
				res = await fixture.fetch(src);
				expect(res.status).to.equal(200);
				expect(res.headers.get('content-type')).to.equal('image/avif');
			});

			it('has a working Picture component', async () => {
				let res = await fixture.fetch('/picturecomponent');
				let html = await res.text();
				$ = cheerio.load(html);

				// Fallback format
				let $img = $('#picture-fallback img');
				expect($img).to.have.a.lengthOf(1);

				const imageURL = new URL($img.attr('src'), 'http://localhost');
				expect(imageURL.searchParams.get('f')).to.equal('jpeg');
				expect($img.attr('fallbackformat')).to.be.undefined;

				// Densities
				$img = $('#picture-density-2-format img');
				let $picture = $('#picture-density-2-format picture');
				let $source = $('#picture-density-2-format source');
				expect($img).to.have.a.lengthOf(1);
				expect($picture).to.have.a.lengthOf(1);
				expect($source).to.have.a.lengthOf(2);

				const srcset = parseSrcset($source.attr('srcset'));
				expect(srcset.every((src) => src.url.startsWith('/_image'))).to.equal(true);
				expect(srcset.map((src) => src.d)).to.deep.equal([undefined, 2]);

				// Widths
				$img = $('#picture-widths img');
				$picture = $('#picture-widths picture');
				$source = $('#picture-widths source');
				expect($img).to.have.a.lengthOf(1);
				expect($picture).to.have.a.lengthOf(1);
				expect($source).to.have.a.lengthOf(1);
				expect($source.attr('sizes')).to.equal(
					'(max-width: 448px) 400px, (max-width: 810px) 750px, 1050px'
				);

				const srcset2 = parseSrcset($source.attr('srcset'));
				expect(srcset2.every((src) => src.url.startsWith('/_image'))).to.equal(true);
				expect(srcset2.map((src) => src.w)).to.deep.equal([207]);
			});

			it('properly deduplicate srcset images', async () => {
				let res = await fixture.fetch('/srcset');
				let html = await res.text();
				$ = cheerio.load(html);

				let localImage = $('#local-3-images img');
				expect(
					new Set([
						...parseSrcset(localImage.attr('srcset')).map((src) => src.url),
						localImage.attr('src'),
					]).size
				).to.equal(3);

				let remoteImage = $('#remote-3-images img');
				expect(
					new Set([
						...parseSrcset(remoteImage.attr('srcset')).map((src) => src.url),
						remoteImage.attr('src'),
					]).size
				).to.equal(3);

				let local1x = $('#local-1x img');
				expect(
					new Set([
						...parseSrcset(local1x.attr('srcset')).map((src) => src.url),
						local1x.attr('src'),
					]).size
				).to.equal(1);

				let remote1x = $('#remote-1x img');
				expect(
					new Set([
						...parseSrcset(remote1x.attr('srcset')).map((src) => src.url),
						remote1x.attr('src'),
					]).size
				).to.equal(1);

				let local2Widths = $('#local-2-widths img');
				expect(
					new Set([
						...parseSrcset(local2Widths.attr('srcset')).map((src) => src.url),
						local2Widths.attr('src'),
					]).size
				).to.equal(2);

				let remote2Widths = $('#remote-2-widths img');
				expect(
					new Set([
						...parseSrcset(remote2Widths.attr('srcset')).map((src) => src.url),
						remote2Widths.attr('src'),
					]).size
				).to.equal(2);
			});
		});

		describe('vite-isms', () => {
			/**
			 * @type {cheerio.CheerioAPI}
			 */
			let $;
			before(async () => {
				let res = await fixture.fetch('/vite');
				let html = await res.text();
				$ = cheerio.load(html);
			});

			it('support ?url imports', () => {
				let $url = $('#url');
				expect($url.text()).to.equal('string');
			});

			it('support ?raw imports', () => {
				let $raw = $('#raw');
				expect($raw.text()).to.equal('string');
			});

			it('support glob import as raw', () => {
				let $raw = $('#glob-import');
				expect($raw.text()).to.equal('string');
			});
		});

		describe('remote', () => {
			describe('working', () => {
				let $;
				before(async () => {
					let res = await fixture.fetch('/');
					let html = await res.text();
					$ = cheerio.load(html);
				});

				it('has proper link and works', async () => {
					let $img = $('#remote img');

					let src = $img.attr('src');
					expect(src.startsWith('/_image?')).to.be.true;
					const imageRequest = await fixture.fetch(src);
					expect(imageRequest.status).to.equal(200);
				});

				it('includes the provided alt', async () => {
					let $img = $('#remote img');
					expect($img.attr('alt')).to.equal('fred');
				});

				it('includes loading and decoding attributes', () => {
					let $img = $('#remote img');
					expect(!!$img.attr('loading')).to.equal(true);
					expect(!!$img.attr('decoding')).to.equal(true);
				});

				it('includes width and height attributes', () => {
					let $img = $('#remote img');
					expect(!!$img.attr('width')).to.equal(true);
					expect(!!$img.attr('height')).to.equal(true);
				});

				it('support data: URI', () => {
					let $img = $('#data-uri img');
					expect($img.attr('src')).to.equal(
						'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA0AAAANCAYAAABy6+R8AAAAAXNSR0IArs4c6QAAAIRlWElmTU0AKgAAAAgABQESAAMAAAABAAEAAAEaAAUAAAABAAAASgEbAAUAAAABAAAAUgEoAAMAAAABAAIAAIdpAAQAAAABAAAAWgAAAAAAAABIAAAAAQAAAEgAAAABAAOgAQADAAAAAQABAACgAgAEAAAAAQAAAA2gAwAEAAAAAQAAAA0AAAAAWvB1rQAAAAlwSFlzAAALEwAACxMBAJqcGAAAAVlpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IlhNUCBDb3JlIDYuMC4wIj4KICAgPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4KICAgICAgPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIKICAgICAgICAgICAgeG1sbnM6dGlmZj0iaHR0cDovL25zLmFkb2JlLmNvbS90aWZmLzEuMC8iPgogICAgICAgICA8dGlmZjpPcmllbnRhdGlvbj4xPC90aWZmOk9yaWVudGF0aW9uPgogICAgICA8L3JkZjpEZXNjcmlwdGlvbj4KICAgPC9yZGY6UkRGPgo8L3g6eG1wbWV0YT4KGV7hBwAAAWJJREFUKBVtUDEsQ1EUve+1/SItKYMIkYpF06GJdGAwNFFGkxBEYupssRm6EpvJbpVoYhRd6FBikDSxYECsBpG25D/nvP/+p+Ik551z73v33feuyA/izq5CL8ET8ALcBolYIP+vd0ibX/yAT7uj2qkVzwWzUBa0nbacbkKJHi5dlYhXmARYeAS+MwCWA5FPqKIP/9IH/wiygMru5y5mcRYkPHYKP7gAPw4SDbCjRXMgRBJctM4t4ROriM2QSpmkeOtub6YfMYrZvelykbD1sxJVg+6AfKqURRKQLfA4JvoVWgIjDMNlGLVKZxNRFsZsoHGAgREZHKPlJEi2t7if3r2KKS9nVOo0rtNZ3yR7M/VGTqTy5Y4o/scWHBbKfIq0/eZ+x3850OZpaTTxlu/4D3ssuA72uxrYS2rFYjh+aRbmb24LpTVu1IqVKG8P/lmUEaNMxeh6fmquOhkMBE8JJ2yPfwPjdVhiDbiX6AAAAABJRU5ErkJggg=='
					);
					expect(!!$img.attr('width')).to.equal(true);
					expect(!!$img.attr('height')).to.equal(true);
				});

				it('support images from public', () => {
					let $img = $('#public img');
					expect($img.attr('src')).to.equal('/penguin3.jpg');
					expect(!!$img.attr('width')).to.equal(true);
					expect(!!$img.attr('height')).to.equal(true);
				});
			});

			it('error if no width and height', async () => {
				logs.length = 0;
				let res = await fixture.fetch('/remote-error-no-dimensions');
				await res.text();

				expect(logs).to.have.a.lengthOf(1);
				expect(logs[0].message).to.contain('Missing width and height attributes');
			});

			it('error if no height', async () => {
				logs.length = 0;
				let res = await fixture.fetch('/remote-error-no-height');
				await res.text();

				expect(logs).to.have.a.lengthOf(1);
				expect(logs[0].message).to.contain('Missing height attribute');
			});

			it('supports aliases', async () => {
				let res = await fixture.fetch('/alias');
				let html = await res.text();
				let $ = cheerio.load(html);

				let $img = $('img');
				expect($img).to.have.a.lengthOf(1);
				expect($img.attr('src').includes('penguin1.jpg')).to.equal(true);
			});
		});

		describe('markdown', () => {
			let $;
			before(async () => {
				let res = await fixture.fetch('/post');
				let html = await res.text();
				$ = cheerio.load(html);
			});

			it('Adds the <img> tag', () => {
				let $img = $('img');
				expect($img).to.have.a.lengthOf(2);

				// Verbose test for the full URL to make sure the image went through the full pipeline
				expect(
					$img.attr('src').startsWith('/_image') && $img.attr('src').endsWith('f=webp')
				).to.equal(true);
			});

			it('has width and height attributes', () => {
				let $img = $('img');
				expect(!!$img.attr('width')).to.equal(true);
				expect(!!$img.attr('height')).to.equal(true);
			});

			it('Supports aliased paths', async () => {
				let res = await fixture.fetch('/aliasMarkdown');
				let html = await res.text();
				$ = cheerio.load(html);

				let $img = $('img');
				expect($img.attr('src').startsWith('/_image')).to.equal(true);
			});

			it('properly handles remote images', async () => {
				let res = await fixture.fetch('/httpImage');
				let html = await res.text();
				$ = cheerio.load(html);

				let $img = $('img');
				expect($img).to.have.a.lengthOf(2);
				const remoteUrls = ['https://example.com/image.png', '/image.png'];
				$img.each((index, element) => {
					expect(element.attribs['src']).to.equal(remoteUrls[index]);
				});
			});
		});

		describe('getImage', () => {
			let $;
			before(async () => {
				let res = await fixture.fetch('/get-image');
				let html = await res.text();
				$ = cheerio.load(html);
			});

			it('Adds the <img> tag', () => {
				let $img = $('img');
				expect($img).to.have.a.lengthOf(1);
				expect($img.attr('src').startsWith('/_image')).to.equal(true);
			});

			it('includes the provided alt', () => {
				let $img = $('img');
				expect($img.attr('alt')).to.equal('a penguin');
			});
		});

		describe('content collections', () => {
			let $;
			before(async () => {
				let res = await fixture.fetch('/blog/one');
				let html = await res.text();
				$ = cheerio.load(html);
			});

			it('Adds the <img> tags', () => {
				let $img = $('img');
				expect($img).to.have.a.lengthOf(7);
			});

			it('has proper source for directly used image', () => {
				let $img = $('#direct-image img');
				expect($img.attr('src').startsWith('/')).to.equal(true);
			});

			it('has proper source for refined image', () => {
				let $img = $('#refined-image img');
				expect($img.attr('src').startsWith('/')).to.equal(true);
			});

			it('has proper sources for array of images', () => {
				let $img = $('#array-of-images img');
				const imgsSrcs = [];
				$img.each((i, img) => imgsSrcs.push(img.attribs['src']));
				expect($img).to.have.a.lengthOf(2);
				expect(imgsSrcs.every((img) => img.startsWith('/'))).to.be.true;
			});

			it('has proper attributes for optimized image through getImage', () => {
				let $img = $('#optimized-image-get-image img');
				expect($img.attr('src').startsWith('/_image')).to.equal(true);
				expect($img.attr('width')).to.equal('207');
				expect($img.attr('height')).to.equal('243');
			});

			it('has proper attributes for optimized image through Image component', () => {
				let $img = $('#optimized-image-component img');
				expect($img.attr('src').startsWith('/_image')).to.equal(true);
				expect($img.attr('width')).to.equal('207');
				expect($img.attr('height')).to.equal('243');
				expect($img.attr('alt')).to.equal('A penguin!');
			});

			it('properly handles nested images', () => {
				let $img = $('#nested-image img');
				expect($img.attr('src').startsWith('/')).to.equal(true);
			});
		});

		describe('regular img tag', () => {
			/** @type {ReturnType<import('cheerio')['load']>} */
			let $;
			before(async () => {
				let res = await fixture.fetch('/regular-img');
				let html = await res.text();
				$ = cheerio.load(html);
			});

			it('does not have a file url', async () => {
				expect($('img').attr('src').startsWith('file://')).to.equal(false);
			});

			it('includes /src in the path', async () => {
				expect($('img').attr('src').includes('/src')).to.equal(true);
			});
		});

		describe('custom service', () => {
			it('custom service implements getHTMLAttributes', async () => {
				const response = await fixture.fetch('/');
				const html = await response.text();

				const $ = cheerio.load(html);
				expect($('#local img').attr('data-service')).to.equal('my-custom-service');
			});

			it('custom service works in Markdown', async () => {
				const response = await fixture.fetch('/post');
				const html = await response.text();

				const $ = cheerio.load(html);
				expect($('img').attr('data-service')).to.equal('my-custom-service');
			});

			it('gets service config', async () => {
				const response = await fixture.fetch('/');
				const html = await response.text();

				const $ = cheerio.load(html);
				expect($('#local img').attr('data-service-config')).to.equal('bar');
			});
		});

		describe('custom endpoint', async () => {
			/** @type {import('./test-utils').DevServer} */
			let customEndpointDevServer;

			/** @type {import('./test-utils.js').Fixture} */
			let customEndpointFixture;

			before(async () => {
				customEndpointFixture = await loadFixture({
					root: './fixtures/core-image/',
					image: {
						endpoint: './src/custom-endpoint.ts',
						service: testImageService({ foo: 'bar' }),
						domains: ['avatars.githubusercontent.com'],
					},
				});

				customEndpointDevServer = await customEndpointFixture.startDevServer({
					server: { port: 4324 },
				});
			});

			it('custom endpoint works', async () => {
				const response = await customEndpointFixture.fetch('/');
				const html = await response.text();

				const $ = cheerio.load(html);
				const src = $('#local img').attr('src');

				let res = await customEndpointFixture.fetch(src);
				expect(res.status).to.equal(200);
				expect(await res.text()).to.equal(
					"You fool! I'm not a image endpoint at all, I just return this!"
				);
			});

			after(async () => {
				await customEndpointDevServer.stop();
			});
		});
	});

	describe('proper errors', () => {
		/** @type {import('./test-utils').DevServer} */
		let devServer;
		/** @type {Array<{ type: any, level: 'error', message: string; }>} */
		let logs = [];

		before(async () => {
			fixture = await loadFixture({
				root: './fixtures/core-image-errors/',
				image: {
					service: testImageService(),
				},
			});

			devServer = await fixture.startDevServer({
				logger: new Logger({
					level: 'error',
					dest: new Writable({
						objectMode: true,
						write(event, _, callback) {
							logs.push(event);
							callback();
						},
					}),
				}),
			});
		});

		after(async () => {
			await devServer.stop();
		});

		it("properly error when getImage's first parameter isn't filled", async () => {
			logs.length = 0;
			let res = await fixture.fetch('/get-image-empty');
			await res.text();

			expect(logs).to.have.a.lengthOf(1);
			expect(logs[0].message).to.contain('Expected getImage() parameter');
		});

		it('properly error when src is undefined', async () => {
			logs.length = 0;
			let res = await fixture.fetch('/get-image-undefined');
			await res.text();

			expect(logs).to.have.a.lengthOf(1);
			expect(logs[0].message).to.contain('Expected `src` property');
		});

		it('properly error image in Markdown frontmatter is not found', async () => {
			logs.length = 0;
			let res = await fixture.fetch('/blog/one');
			await res.text();

			expect(logs).to.have.a.lengthOf(1);
			expect(logs[0].message).to.contain('does not exist. Is the path correct?');
		});

		it('properly error image in Markdown content is not found', async () => {
			logs.length = 0;
			let res = await fixture.fetch('/post');
			await res.text();
			expect(logs).to.have.a.lengthOf(1);
			expect(logs[0].message).to.contain('Could not find requested image');
		});
	});

	describe('support base option correctly', () => {
		before(async () => {
			fixture = await loadFixture({
				root: './fixtures/core-image-base/',
				image: {
					service: testImageService(),
				},
				base: '/blog',
			});
			await fixture.build();
		});

		it('has base path prefix when using the Image component', async () => {
			const html = await fixture.readFile('/index.html');
			const $ = cheerio.load(html);
			const src = $('#local img').attr('src');
			expect(src.length).to.be.greaterThan(0);
			expect(src.startsWith('/blog')).to.be.true;
		});

		it('has base path prefix when using getImage', async () => {
			const html = await fixture.readFile('/get-image/index.html');
			const $ = cheerio.load(html);
			const src = $('img').attr('src');
			expect(src.length).to.be.greaterThan(0);
			expect(src.startsWith('/blog')).to.be.true;
		});

		it('has base path prefix when using image directly', async () => {
			const html = await fixture.readFile('/direct/index.html');
			const $ = cheerio.load(html);
			const src = $('img').attr('src');
			expect(src.length).to.be.greaterThan(0);
			expect(src.startsWith('/blog')).to.be.true;
		});

		it('has base path prefix in Markdown', async () => {
			const html = await fixture.readFile('/post/index.html');
			const $ = cheerio.load(html);
			const src = $('img').attr('src');
			expect(src.length).to.be.greaterThan(0);
			expect(src.startsWith('/blog')).to.be.true;
		});

		it('has base path prefix in Content Collection frontmatter', async () => {
			const html = await fixture.readFile('/blog/one/index.html');
			const $ = cheerio.load(html);
			const src = $('img').attr('src');
			expect(src.length).to.be.greaterThan(0);
			expect(src.startsWith('/blog')).to.be.true;
		});

		it('has base path prefix in SSR', async () => {
			const fixtureWithBase = await loadFixture({
				root: './fixtures/core-image-ssr/',
				output: 'server',
				adapter: testAdapter(),
				image: {
					service: testImageService(),
				},
				base: '/blog',
			});
			await fixtureWithBase.build();
			const app = await fixtureWithBase.loadTestAdapterApp();
			const request = new Request('http://example.com/blog/');
			const response = await app.render(request);
			expect(response.status).to.equal(200);
			const html = await response.text();
			const $ = cheerio.load(html);
			const src = $('#local img').attr('src');
			expect(src.startsWith('/blog')).to.be.true;
		});
	});

	describe('build ssg', () => {
		before(async () => {
			fixture = await loadFixture({
				root: './fixtures/core-image-ssg/',
				image: {
					service: testImageService(),
					domains: ['astro.build', 'avatars.githubusercontent.com'],
				},
			});
			// Remove cache directory
			removeDir(new URL('./fixtures/core-image-ssg/node_modules/.astro', import.meta.url));

			await fixture.build();
		});

		it('writes out images to dist folder', async () => {
			const html = await fixture.readFile('/index.html');
			const $ = cheerio.load(html);
			const src = $('#local img').attr('src');
			expect(src.length).to.be.greaterThan(0);
			const data = await fixture.readFile(src, null);
			expect(data).to.be.an.instanceOf(Buffer);
		});

		it('writes out allowed remote images', async () => {
			const html = await fixture.readFile('/remote/index.html');
			const $ = cheerio.load(html);
			const src = $('#remote img').attr('src');
			expect(src.length).to.be.greaterThan(0);
			const data = await fixture.readFile(src, null);
			expect(data).to.be.an.instanceOf(Buffer);
		});

		it('writes out images to dist folder with proper extension if no format was passed', async () => {
			const html = await fixture.readFile('/index.html');
			const $ = cheerio.load(html);
			const src = $('#local img').attr('src');
			expect(src.endsWith('.webp')).to.be.true;
		});

		it('getImage() usage also written', async () => {
			const html = await fixture.readFile('/get-image/index.html');
			const $ = cheerio.load(html);
			let $img = $('img');

			// <img> tag
			expect($img).to.have.a.lengthOf(1);
			expect($img.attr('alt')).to.equal('a penguin');

			// image itself
			const src = $img.attr('src');
			const data = await fixture.readFile(src, null);
			expect(data).to.be.an.instanceOf(Buffer);
		});

		it('Picture component images are written', async () => {
			const html = await fixture.readFile('/picturecomponent/index.html');
			const $ = cheerio.load(html);
			let $img = $('img');
			let $source = $('source');

			expect($img).to.have.a.lengthOf(1);
			expect($source).to.have.a.lengthOf(2);

			const srcset = parseSrcset($source.attr('srcset'));
			let hasExistingSrc = await Promise.all(
				srcset.map(async (src) => {
					const data = await fixture.readFile(src.url, null);
					return data instanceof Buffer;
				})
			);

			expect(hasExistingSrc.every((src) => src === true)).to.deep.equal(true);
		});

		it('markdown images are written', async () => {
			const html = await fixture.readFile('/post/index.html');
			const $ = cheerio.load(html);
			let $img = $('img');

			// <img> tag
			expect($img).to.have.a.lengthOf(1);
			expect($img.attr('alt')).to.equal('My article cover');

			// image itself
			const src = $img.attr('src');
			const data = await fixture.readFile(src, null);
			expect(data).to.be.an.instanceOf(Buffer);
		});

		it('aliased images are written', async () => {
			const html = await fixture.readFile('/alias/index.html');

			const $ = cheerio.load(html);
			let $img = $('img');

			// <img> tag
			expect($img).to.have.a.lengthOf(1);
			expect($img.attr('alt')).to.equal('A penguin!');

			// image itself
			const src = $img.attr('src');
			const data = await fixture.readFile(src, null);
			expect(data).to.be.an.instanceOf(Buffer);
		});

		it('aliased images in Markdown are written', async () => {
			const html = await fixture.readFile('/aliasMarkdown/index.html');

			const $ = cheerio.load(html);
			let $img = $('img');

			// <img> tag
			expect($img).to.have.a.lengthOf(1);
			expect($img.attr('alt')).to.equal('A penguin');

			// image itself
			const src = $img.attr('src');
			const data = await fixture.readFile(src, null);
			expect(data).to.be.an.instanceOf(Buffer);
		});

		it('output files for content collections images', async () => {
			const html = await fixture.readFile('/blog/one/index.html');

			const $ = cheerio.load(html);
			let $img = $('img');
			expect($img).to.have.a.lengthOf(2);

			const srcdirect = $('#direct-image img').attr('src');
			const datadirect = await fixture.readFile(srcdirect, null);
			expect(datadirect).to.be.an.instanceOf(Buffer);

			const srcnested = $('#nested-image img').attr('src');
			const datanested = await fixture.readFile(srcnested, null);
			expect(datanested).to.be.an.instanceOf(Buffer);
		});

		it('quality attribute produces a different file', async () => {
			const html = await fixture.readFile('/quality/index.html');
			const $ = cheerio.load(html);
			expect($('#no-quality img').attr('src')).to.not.equal($('#quality-low img').attr('src'));
		});

		it('quality can be a number between 0-100', async () => {
			const html = await fixture.readFile('/quality/index.html');
			const $ = cheerio.load(html);
			expect($('#no-quality img').attr('src')).to.not.equal($('#quality-num img').attr('src'));
		});

		it('format attribute produces a different file', async () => {
			const html = await fixture.readFile('/format/index.html');
			const $ = cheerio.load(html);
			expect($('#no-format img').attr('src')).to.not.equal($('#format-avif img').attr('src'));
		});

		it('has cache entries', async () => {
			const generatedImages = (await fixture.glob('_astro/**/*.webp'))
				.map((path) => basename(path))
				.sort();
			const cachedImages = [
				...(await fixture.glob('../node_modules/.astro/assets/**/*.webp')),
				...(await fixture.glob('../node_modules/.astro/assets/**/*.json')),
			]
				.map((path) => basename(path).replace('.webp.json', '.webp'))
				.sort();

			expect(generatedImages).to.deep.equal(cachedImages);
		});

		it('uses cache entries', async () => {
			const logs = [];
			const logging = {
				dest: {
					write(chunk) {
						logs.push(chunk);
					},
				},
			};

			await fixture.build({ logging });
			const generatingImageIndex = logs.findIndex((logLine) =>
				logLine.message.includes('generating optimized images')
			);
			const relevantLogs = logs.slice(generatingImageIndex + 1, -1);
			const isReusingCache = relevantLogs.every((logLine) =>
				logLine.message.includes('(reused cache entry)')
			);

			expect(isReusingCache).to.be.true;
		});

		it('client images are written to build', async () => {
			const html = await fixture.readFile('/client/index.html');
			const $ = cheerio.load(html);
			let $script = $('script');

			// Find image
			const regex = /src:"([^"]*)/gm;
			const imageSrc = regex.exec($script.html())[1];
			const data = await fixture.readFile(imageSrc, null);
			expect(data).to.be.an.instanceOf(Buffer);
		});

		it('client images srcset parsed correctly', async () => {
			const html = await fixture.readFile('/srcset/index.html');
			const $ = cheerio.load(html);
			const srcset = $('#local-2-widths-with-spaces img').attr('srcset');

			// Find image
			const regex = /^(.+?) [0-9]+[wx]$/gm;
			const imageSrcset = regex.exec(srcset)[1];
			expect(imageSrcset).to.not.contain(' ');
		});

		it('supports images with encoded characters in url', async () => {
			const html = await fixture.readFile('/index.html');
			const $ = cheerio.load(html);
			const img = $('#encoded-chars img');
			const src = img.attr('src');
			const data = await fixture.readFile(src);
			expect(data).to.not.be.undefined;
		});

		describe('custom service in build', () => {
			it('uses configured hashes properties', async () => {
				await fixture.build();
				const html = await fixture.readFile('/imageDeduplication/index.html');

				const $ = cheerio.load(html);

				const allTheSamePath = $('#all-the-same img')
					.map((_, el) => $(el).attr('src'))
					.get();

				expect(allTheSamePath.every((path) => path === allTheSamePath[0])).to.equal(true);

				const useCustomHashProperty = $('#use-data img')
					.map((_, el) => $(el).attr('src'))
					.get();
				expect(useCustomHashProperty.every((path) => path === useCustomHashProperty[0])).to.equal(
					false
				);
				expect(useCustomHashProperty[1]).to.not.equal(allTheSamePath[0]);
			});
		});
	});

	describe('dev ssr', () => {
		let devServer;
		before(async () => {
			fixture = await loadFixture({
				root: './fixtures/core-image-ssr/',
				output: 'server',
				adapter: testAdapter(),
				image: {
					service: testImageService(),
				},
			});
			devServer = await fixture.startDevServer();
		});

		after(async () => {
			await devServer.stop();
		});

		it('does not interfere with query params', async () => {
			let res = await fixture.fetch('/api?src=image.png');
			const html = await res.text();
			expect(html).to.equal('An image: "image.png"');
		});
	});

	describe('prod ssr', () => {
		before(async () => {
			fixture = await loadFixture({
				root: './fixtures/core-image-ssr/',
				output: 'server',
				adapter: testAdapter(),
				image: {
					endpoint: 'astro/assets/endpoint/node',
					service: testImageService(),
				},
			});
			await fixture.build();
		});

		it('dynamic route images are built at response time', async () => {
			const app = await fixture.loadTestAdapterApp();
			let request = new Request('http://example.com/');
			let response = await app.render(request);
			expect(response.status).to.equal(200);
			const html = await response.text();
			const $ = cheerio.load(html);
			const src = $('#local img').attr('src');
			request = new Request('http://example.com' + src);
			response = await app.render(request);
			expect(response.status).to.equal(200);
		});

		it('prerendered routes images are built', async () => {
			const html = await fixture.readFile('/client/prerender/index.html');
			const $ = cheerio.load(html);
			const src = $('img').attr('src');
			const imgData = await fixture.readFile('/client' + src, null);
			expect(imgData).to.be.an.instanceOf(Buffer);
		});
	});
});
