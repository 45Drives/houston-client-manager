export const formatFrequency = (frequency: "hour" | "day" | "week" | "month") => {
    const frequencyMap: Record<string, string> = {
        hour: "hourly",
        day: "daily",
        week: "weekly",
        month: "monthly"
    };
    return frequencyMap[frequency] || frequency; // Default to original if unknown
};

export const sanitizeFilePath = (input: string) => {
    return input
      .replace(/[:*?"<>|]/g, '') // replace illegal characters with underscore
      .replace(/\s+/g, ' ')           // optional: collapse multiple spaces
      .replace(/\\/g, "/")           // optional: collapse multiple spaces
      .trim();                        // trim leading/trailing whitespace
  }
  