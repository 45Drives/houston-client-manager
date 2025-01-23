import { ref, type Ref } from "vue";

const advancedModeState = ref(false);

const setAdavancedMode = (advanced?: "simple" | "advanced") => {
  advanced =
  advanced ??
    "simple";
  if (advanced === "advanced") {
    advancedModeState.value = true;
  } else {
    advancedModeState.value = false;
  }
};

setAdavancedMode();

export function useAdvancedModeState(): Ref<boolean> {
  return advancedModeState;
}
