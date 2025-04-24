/**
 * API客户端，用于处理与后端的通信
 */

export interface ApiResponse<T> {
  success: boolean;
  directCode?: string;
  patch?: string;
  error?: string;
  message?: string;
  data?: T;
}

/**
 * 测试API调用
 */
export async function callTestApi(): Promise<ApiResponse<{ message: string }>> {
  try {
    // 使用相对路径，使用./开头
    console.log("测试API调用开始...");
    const response = await fetch("./api/test");
    console.log("测试API响应状态:", response.status);
    return await response.json();
  } catch (error) {
    console.error("测试API调用失败:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "未知错误",
    };
  }
}

/**
 * 调用Agent API
 */
export async function callAgentApi(data: {
  instruction: string;
  currentCode?: string;
  image?: string;
}): Promise<ApiResponse<unknown>> {
  try {
    console.log("调用Agent API开始...");

    // 使用相对URL，以./开头
    const response = await fetch("./api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    console.log("Agent API响应状态:", response.status);

    // 先检查响应状态
    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      console.error("API响应错误:", response.status, errorText);
      return {
        success: false,
        error: `API响应错误: ${response.status} ${errorText}`,
      };
    }

    // 尝试解析JSON
    try {
      return await response.json();
    } catch (jsonError) {
      console.error("JSON解析错误:", jsonError);
      return {
        success: false,
        error: "无法解析API响应",
      };
    }
  } catch (error) {
    // 捕获网络错误
    console.error("Agent API调用失败:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "网络请求失败",
    };
  }
}
