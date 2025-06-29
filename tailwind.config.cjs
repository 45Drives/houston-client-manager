module.exports = {
	content: [
		"./src/renderer/index.html",
		"./src/renderer/**/*.{vue,js,ts,jsx,tsx}",
	],
	theme: {
		extend: {
			fontFamily: {
				redhat: ['Red Hat Text', 'open-sans', 'sans-serif'],
				"source-sans-pro": ["Source Sans Pro", 'open-sans', 'sans-serif'],
			},
			colors: {
				neutral: {
					850: "#222222",
				}
			}
		},
	},
	plugins: [
		require('@tailwindcss/forms'),
	],
	darkMode: "class",
}
