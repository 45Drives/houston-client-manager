export const formatFrequency = (frequency: "hour" | "day" | "week" | "month") => {
    const frequencyMap: Record<string, string> = {
        hour: "hourly",
        day: "daily",
        week: "weekly",
        month: "monthly"
    };
    return frequencyMap[frequency] || frequency; // Default to original if unknown
};
