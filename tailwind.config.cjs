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
					750: "#2a2a2a",
					850: "#222222",
				}
			},
			keyframes: {
				'indeterminate-bar': {
					'0%': { width: '30%', marginLeft: '0%' },
					'50%': { width: '30%', marginLeft: '70%' },
					'100%': { width: '30%', marginLeft: '0%' },
				},
			},
			animation: {
				'indeterminate-bar': 'indeterminate-bar 1.5s ease-in-out infinite',
			},
		},
	},
	plugins: [
		require('@tailwindcss/forms'),
	],
	darkMode: "class",
}
