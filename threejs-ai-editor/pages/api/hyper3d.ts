// pages/api/hyper3d.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { hyper3d } from "../../lib/hyper3d";
import { processModelUrls } from "../../lib/services/urlValidationService";

type DownloadItem = { name: string; url: string };
type ApiResponse = { downloadUrls?: DownloadItem[]; error?: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "只支持 POST" });
  try {
    const options = req.body.options;
    const { uuid, jobs } = await hyper3d.generate(options);

    // Poll for job completion
    let status;
    do {
      await new Promise((r) => setTimeout(r, 3000));
      status = await hyper3d.checkStatus(jobs.subscription_key);
    } while (status.jobs.some((j: { status: string }) => j.status !== "Done"));

    // Fetch download data
    const dl = await hyper3d.download(uuid, options.geometryFileFormat);

    // Extract download URLs
    const downloadUrls = dl.list.map((item: { name: string; url: string }) => ({
      name: item.name,
      url: item.url,
    }));

    // No URLs returned
    if (!downloadUrls || downloadUrls.length === 0) {
      console.error("No download URLs returned from Hyper3D API");
      return res.status(500).json({ error: "No model URLs generated" });
    }

    // Validate URLs before returning to frontend
    console.log(
      `Validating ${downloadUrls.length} model URLs before sending to frontend...`
    );
    const validatedUrls = await processModelUrls(downloadUrls, {
      timeoutMs: 15000, // Longer timeout for model files
      retries: 3,
    });

    // If no valid URLs, return error
    if (validatedUrls.length === 0) {
      console.error("No valid model URLs found after validation");
      return res.status(500).json({ error: "No valid model URLs available" });
    }

    console.log(
      `Returning ${validatedUrls.length} validated model URLs to frontend`
    );
    res.status(200).json({ downloadUrls: validatedUrls });
  } catch (e: unknown) {
    console.error("Error in hyper3d API:", e);
    res
      .status(500)
      .json({ error: e instanceof Error ? e.message : "未知错误" });
  }
}
