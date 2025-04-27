// Type definitions
export type MeshMode = "Raw" | "Quad" | "Ultra";
export type QualityLevel = "high" | "medium" | "low" | "extra-low";
export type MaterialStyle = "pbr" | "shaded";
export type FileFormat = "glb" | "usdz" | "fbx" | "obj" | "stl";
export type ImageMode = "multi-view" | "fuse";

export type GenerateOptions = {
  prompt?: string;
  imageUrls?: string[];
  imageMode?: ImageMode;
  meshMode?: MeshMode;
  meshSimplify?: boolean;
  meshSmooth?: boolean;
  quality?: QualityLevel;
  bboxCondition?: [number, number, number];
  useHyper?: boolean;
  TAPose?: boolean;
  material?: MaterialStyle;
  geometryFileFormat?: FileFormat;
  tier?: string;
};

type GenerateResponse = {
  uuid: string;
  jobs: {
    uuids: string[];
    subscription_key: string;
  };
};

type StatusResponse = {
  jobs: Array<{
    uuid: string;
    status: string;
    progress?: number;
  }>;
};

type DownloadResponse = {
  list: Array<{
    name: string;
    url: string;
    originalName?: string;
    format?: string;
  }>;
};

const HYPER3D_API_URL = process.env.HYPER3D_API_URL;
const HYPER3D_API_KEY = process.env.HYPER3D_API_KEY;

if (!HYPER3D_API_URL || !HYPER3D_API_KEY) {
  throw new Error(
    "HYPER3D_API_URL and HYPER3D_API_KEY environment variables must be set"
  );
}

export const hyper3d = {
  // Generate a 3D model
  generate: async (options: GenerateOptions): Promise<GenerateResponse> => {
    const {
      prompt,
      imageUrls,
      imageMode = "multi-view",
      meshMode = "Quad",
      meshSimplify = true,
      meshSmooth = true,
      quality = "medium",
      bboxCondition,
      useHyper = false,
      TAPose = false,
      material = "pbr",
      geometryFileFormat = "glb",
      tier = "Regular",
    } = options;

    // Prepare request body
    const formData = new FormData();

    // Add tier to form data
    formData.append("tier", tier);

    // Add prompt if provided
    if (prompt) {
      formData.append("prompt", prompt);
    }

    // Add images if provided
    if (imageUrls && imageUrls.length > 0) {
      // Fetch and append all images to form data
      await Promise.all(
        imageUrls.map(async (url, index) => {
          const imageResponse = await fetch(url);
          const imageBlob = await imageResponse.blob();
          formData.append("images", imageBlob, `image${index}.jpg`);
        })
      );

      // Add image mode for multiple images
      if (imageUrls.length > 1) {
        formData.append(
          "condition_mode",
          imageMode === "multi-view" ? "concat" : "fuse"
        );
      }
    }

    // Add mesh settings
    formData.append("mesh_mode", meshMode);
    if (meshMode === "Raw") {
      formData.append("mesh_simplify", meshSimplify.toString());
    } else if (meshMode === "Quad") {
      formData.append("mesh_smooth", meshSmooth.toString());
      formData.append("quality", quality);
    }

    // Add bounding box condition if provided
    if (bboxCondition) {
      bboxCondition.forEach((condition) => {
        formData.append("bbox_condition", condition.toString());
      });
    }

    // Add hyper detail and T/A pose
    formData.append("use_hyper", useHyper.toString());
    formData.append("TAPose", TAPose.toString());

    // Add material and file format
    if (material === "pbr") {
      formData.append("material", material.toUpperCase());
    } else if (material === "shaded") {
      formData.append("material", "Shaded");
    } else {
      formData.append("material", material);
    }

    if (geometryFileFormat === "usdz") {
      formData.append("geometry_file_format", "glb");
    } else {
      formData.append("geometry_file_format", geometryFileFormat);
    }

    console.info("\n\nhyper3d generation formData:", formData, "\n\n");
    // Make API request
    const response = await fetch(`${HYPER3D_API_URL}/rodin`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HYPER3D_API_KEY}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Hyper3D API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    return await response.json();
  },

  // Check the status of a generation
  checkStatus: async (subscriptionKey: string): Promise<StatusResponse> => {
    const response = await fetch(`${HYPER3D_API_URL}/status`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HYPER3D_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        subscription_key: subscriptionKey,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Hyper3D API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    return await response.json();
  },

  // Download the generated model
  download: async (
    taskUuid: string,
    format?: FileFormat
  ): Promise<DownloadResponse> => {
    const response = await fetch(`${HYPER3D_API_URL}/download`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HYPER3D_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        task_uuid: taskUuid,
        format: format, // Add format parameter if specified
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Hyper3D API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const data = await response.json();

    // Process the response to handle different file formats
    return {
      list: data.list.map((item: { name: string }) => {
        const extension = item.name.split(".").pop();
        const format = extension?.toLowerCase() as FileFormat;
        return {
          ...item,
          originalName: item.name,
          name: `${taskUuid}.${extension}`,
          format,
        };
      }),
    };
  },
};
