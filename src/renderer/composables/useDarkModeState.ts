import { onMounted, ref, watch } from "vue";
const darkModeState = ref(window.matchMedia("(prefers-color-scheme: dark)").matches);

export function useDarkModeState() {

  onMounted(() => {
    const darkModeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    // Listen to changes in dark mode preference
    darkModeMediaQuery.addEventListener('change', (event) => {
      darkModeState.value = event.matches;
    });

    // Initially apply the dark mode based on the current preference
    if (darkModeState.value) {
      document.body.classList.add("dark");
    } else {
      document.body.classList.remove("dark");
    }
  });

  watch(darkModeState, (newValue, oldValue) => {
    if (newValue) {
      document.body.classList.add("dark");
    } else {
      document.body.classList.remove("dark");
    }
  });

  return darkModeState;
}
