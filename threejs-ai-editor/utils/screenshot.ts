import html2canvas from "html2canvas";

export async function captureThreeJsCanvas(
  canvasElement: HTMLCanvasElement
): Promise<string> {
  try {
    // 直接从Canvas元素获取图像数据
    const base64Image = canvasElement.toDataURL("image/png");

    // 添加调试日志
    console.log("截图成功，数据大小:", base64Image.length);

    // 验证截图内容不为空
    if (base64Image === "data:,") {
      console.error("获取到空白截图");
      throw new Error("截图内容为空");
    }

    return base64Image;
  } catch (error) {
    console.error("Error capturing Three.js canvas:", error);
    throw error;
  }
}
