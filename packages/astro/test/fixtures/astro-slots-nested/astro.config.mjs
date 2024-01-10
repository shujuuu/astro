import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import preact from '@astrojs/preact';
import solid from '@astrojs/solid-js';
import svelte from '@astrojs/svelte';
import vue from '@astrojs/vue';

export default defineConfig({
	integrations: [
		preact({ include: ['**/preact/*'] }),
		solid({ include: ['**/solid/*'] }),
		react({ include: ['**/react/*'] }),
		svelte(),
		vue()
	]
});
