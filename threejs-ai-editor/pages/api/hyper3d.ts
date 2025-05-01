// pages/api/hyper3d.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { hyper3d } from "../../lib/hyper3d";

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
    let status;
    do {
      await new Promise((r) => setTimeout(r, 3000));
      status = await hyper3d.checkStatus(jobs.subscription_key);
    } while (status.jobs.some((j: { status: string }) => j.status !== "Done"));
    const dl = await hyper3d.download(uuid, options.geometryFileFormat);
    const downloadUrls = dl.list.map((item: { name: string; url: string }) => ({
      name: item.name,
      url: item.url,
    }));
    res.status(200).json({ downloadUrls });
  } catch (e: unknown) {
    res
      .status(500)
      .json({ error: e instanceof Error ? e.message : "未知错误" });
  }
}
