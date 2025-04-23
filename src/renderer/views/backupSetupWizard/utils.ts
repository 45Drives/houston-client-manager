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
      .replace(/[\/\\:*?"<>|]/g, '_') // replace illegal characters with underscore
      .replace(/\s+/g, ' ')           // optional: collapse multiple spaces
      .trim();                        // trim leading/trailing whitespace
  }
  