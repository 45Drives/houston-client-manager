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
  
export function deconstructFullTarget(fullPath: string): {
    smbHost: string;
    smbShare: string;
    targetPath: string;
} | null {
    try {
        const match = fullPath.match(/^([^:]+):([^/]+)\/(.+)$/);

        if (!match) {
            console.warn(" Invalid full SMB path format:", fullPath);
            return null;
        }

        const [, smbHost, smbShare, targetPath] = match;

        return { smbHost, smbShare, targetPath };
    } catch (err) {
        console.error(" Failed to parse full SMB path:", err);
        return null;
    }
}