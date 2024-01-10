import { expect } from 'chai';
import { loadFixture } from './test-utils.js';
import testAdapter from './test-adapter.js';
import * as cheerio from 'cheerio';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('astro:ssr-manifest, split', () => {
	/** @type {import('./test-utils').Fixture} */
	let fixture;
	let entryPoints;
	let currentRoutes;

	before(async () => {
		fixture = await loadFixture({
			root: './fixtures/ssr-split-manifest/',
			output: 'server',
			adapter: testAdapter({
				setEntryPoints(entries) {
					if (entries) {
						entryPoints = entries;
					}
				},
				setRoutes(routes) {
					currentRoutes = routes;
				},
				extendAdapter: {
					adapterFeatures: {
						functionPerRoute: true,
					},
				},
			}),
			// test suite was authored when inlineStylesheets defaulted to never
			build: { inlineStylesheets: 'never' },
		});
		await fixture.build();
	});

	it('should be able to render a specific entry point', async () => {
		const pagePath = 'src/pages/index.astro';
		const app = await fixture.loadEntryPoint(pagePath, currentRoutes);
		const request = new Request('http://example.com/');
		const response = await app.render(request);
		const html = await response.text();

		const $ = cheerio.load(html);
		expect($('#assets').text()).to.match(
			/\["\/_astro\/index\.([\w-]{8})\.css","\/prerender\/index\.html"\]/
		);
	});

	it('should give access to entry points that exists on file system', async () => {
		// number of the pages inside src/
		expect(entryPoints.size).to.equal(6);
		for (const fileUrl of entryPoints.values()) {
			let filePath = fileURLToPath(fileUrl);
			expect(existsSync(filePath)).to.be.true;
		}
	});

	it('should correctly emit the the pre render page', async () => {
		const text = readFileSync(
			resolve('./test/fixtures/ssr-split-manifest/dist/client/prerender/index.html'),
			{
				encoding: 'utf8',
			}
		);
		expect(text.includes('<title>Pre render me</title>')).to.be.true;
	});

	it('should emit an entry point to request the pre-rendered page', async () => {
		const pagePath = 'src/pages/prerender.astro';
		const app = await fixture.loadEntryPoint(pagePath, currentRoutes);
		const request = new Request('http://example.com/');
		const response = await app.render(request);
		const html = await response.text();
		expect(html.includes('<title>Pre render me</title>')).to.be.true;
	});

	describe('when function per route is enabled', async () => {
		before(async () => {
			fixture = await loadFixture({
				root: './fixtures/ssr-split-manifest/',
				output: 'server',
				adapter: testAdapter({
					setEntryPoints(entries) {
						if (entries) {
							entryPoints = entries;
						}
					},
					setRoutes(routes) {
						currentRoutes = routes;
					},
					extendAdapter: {
						adapterFeatures: {
							functionPerRoute: true,
						},
					},
				}),
				// test suite was authored when inlineStylesheets defaulted to never
				build: { inlineStylesheets: 'never' },
			});
			await fixture.build();
		});
		it('should correctly build, and not create a "uses" entry point', async () => {
			const pagePath = 'src/pages/index.astro';
			const app = await fixture.loadEntryPoint(pagePath, currentRoutes);
			const request = new Request('http://example.com/');
			const response = await app.render(request);
			const html = await response.text();
			expect(html.includes('<title>Testing</title>')).to.be.true;
		});
	});
});
