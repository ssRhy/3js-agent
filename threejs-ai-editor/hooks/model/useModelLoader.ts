import { useState, useCallback } from "react";
import * as THREE from "three";
import { useSceneStore } from "../../stores/useSceneStore";
import { ThreeSceneRef } from "../three/useThreeScene";

export const useModelLoader = (
  threeRef: React.RefObject<ThreeSceneRef | null>
) => {
  const [loadedModels, setLoadedModels] = useState<
    { id: string; url: string }[]
  >([]);
  const [isModelLoading, setIsModelLoading] = useState<boolean>(false);
  const [allModelUrls, setAllModelUrls] = useState<
    { url: string; lastUsed: Date }[]
  >([]);

  const { registerObject } = useSceneStore();

  const fitCameraToModel = useCallback(
    (camera: THREE.PerspectiveCamera, model: THREE.Object3D) => {
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      const maxDim = Math.max(size.x, size.y, size.z);
      const fov = camera.fov * (Math.PI / 180);
      let cameraZ = Math.abs(maxDim / Math.sin(fov / 2));

      cameraZ *= 2.0;

      const offsetAngle = Math.random() * Math.PI * 0.25;
      const cameraX = Math.sin(offsetAngle) * cameraZ * 0.8;
      const adjustedCameraZ = Math.cos(offsetAngle) * cameraZ;

      camera.position.set(
        center.x + cameraX,
        center.y + maxDim * 0.4,
        center.z + adjustedCameraZ
      );

      camera.lookAt(center);
      camera.updateProjectionMatrix();
    },
    []
  );

  const autoScaleModel = useCallback(
    (model: THREE.Object3D, desiredSize: number = 5) => {
      const boundingBox = new THREE.Box3().setFromObject(model);
      const size = boundingBox.getSize(new THREE.Vector3());
      const maxDimension = Math.max(size.x, size.y, size.z);

      if (maxDimension === 0) {
        console.warn("无法缩放模型：模型尺寸为0");
        return;
      }

      const scale = desiredSize / maxDimension;
      model.scale.set(scale, scale, scale);

      console.log(
        `模型已缩放: 原始尺寸=${maxDimension.toFixed(
          2
        )}, 目标尺寸=${desiredSize}, 缩放比例=${scale.toFixed(4)}`
      );

      return scale;
    },
    []
  );

  const loadModel = useCallback(
    async (modelUrl: string, modelSize?: number): Promise<boolean> => {
      if (!threeRef.current || !threeRef.current.gltfLoader) {
        console.error("Three.js scene not initialized");
        return false;
      }

      try {
        setAllModelUrls((prev) => {
          const exists = prev.some((item) => item.url === modelUrl);
          if (!exists) {
            return [...prev, { url: modelUrl, lastUsed: new Date() }];
          } else {
            return prev.map((item) =>
              item.url === modelUrl ? { ...item, lastUsed: new Date() } : item
            );
          }
        });

        setIsModelLoading(true);

        const existingModel = loadedModels.find(
          (model) => model.url === modelUrl
        );
        if (existingModel) {
          console.log("模型已加载，使用现有实例:", modelUrl);
          setIsModelLoading(false);

          if (threeRef.current && threeRef.current.scene) {
            threeRef.current.scene.traverse((obj) => {
              if (obj.userData && obj.userData.modelId === existingModel.id) {
                obj.visible = true;
                console.log("确保模型可见:", obj.name);
              }
            });
          }

          return true;
        }

        // 检查是否是本地上传的模型
        const isLocalModel = modelUrl.startsWith("/uploads/models/");

        let urlToLoad = modelUrl;
        if (
          modelUrl.startsWith("http") &&
          !modelUrl.includes("/api/proxy-model")
        ) {
          console.log("[loadModel] 将外部URL转换为代理URL:", modelUrl);
          urlToLoad = `/api/proxy-model?url=${encodeURIComponent(modelUrl)}`;
        }

        console.log("Loading 3D model from URL:", urlToLoad);
        if (modelSize) {
          console.log(`将调整模型大小为: ${modelSize} 单位`);
        }

        const { scene, camera, dynamicGroup } = threeRef.current;
        const loader = threeRef.current.gltfLoader;

        loader.setCrossOrigin("anonymous");

        return new Promise<boolean>((resolve) => {
          // 处理本地上传的模型
          if (isLocalModel) {
            console.log("Loading local uploaded model:", modelUrl);
            loader.load(
              modelUrl,
              (gltf) => {
                try {
                  console.log("Local model loaded successfully:", gltf);
                  const model = gltf.scene;

                  const boundingBox = new THREE.Box3().setFromObject(model);
                  const size = boundingBox.getSize(new THREE.Vector3());
                  const modelHeight = size.y;

                  autoScaleModel(model, modelSize || 5);

                  // 硬编码：模型底部与地面对齐，并且高度提高 z/2（这里理解为高度的一半）
                  const position = {
                    x: 0,
                    y: modelHeight / 2 + modelHeight / 2,
                    z: 0,
                  };
                  model.position.set(position.x, position.y, position.z);

                  const modelId = `model_${Date.now()}`;
                  model.userData.modelId = modelId;
                  model.userData.isModelObject = true;
                  model.userData.originalModelUrl = modelUrl;
                  model.userData.originalUrl = modelUrl;
                  model.userData.selectable = true; // 明确标记为可选择对象
                  model.userData.isUploadedModel = true; // 标记为上传的模型
                  model.name =
                    modelUrl.split("/").pop()?.split(".")[0] ||
                    `model_${Date.now()}`;

                  model.traverse((node: THREE.Object3D) => {
                    if ((node as THREE.Mesh).isMesh) {
                      console.log(
                        "Applied shadows to mesh:",
                        (node as THREE.Mesh).name || "unnamed mesh"
                      );
                      (node as THREE.Mesh).castShadow = true;
                      (node as THREE.Mesh).receiveShadow = true;
                      node.userData.modelId = modelId;
                      node.userData.originalModelUrl = modelUrl;
                      // 确保子网格不会被误认为是helper对象
                      node.userData.isHelper = false;
                      node.userData.isOutline = false;
                    }
                  });

                  // 将模型添加到dynamicGroup而不是直接添加到scene，以便ObjectManipulationControls可以操控
                  if (dynamicGroup) {
                    dynamicGroup.add(model);
                    console.log(
                      "Model added to dynamicGroup with position:",
                      model.position
                    );
                  } else {
                    scene.add(model);
                    console.log(
                      "Model added to scene (fallback) with position:",
                      model.position
                    );
                  }

                  fitCameraToModel(camera, model);

                  if (registerObject) {
                    const uuid = registerObject(model, "GLTFModel", {
                      originalUrl: modelUrl,
                      loadTimestamp: Date.now(),
                      modelSize: modelSize || 5,
                      isLoadedModel: true,
                      modelId: modelId,
                      originalModelUrl: modelUrl,
                    });
                    console.log(`模型已注册到场景状态管理器，UUID: ${uuid}`);
                  }

                  setLoadedModels((prev) => [
                    ...prev,
                    { id: modelId, url: modelUrl },
                  ]);

                  console.log("Local model loaded successfully");
                  setIsModelLoading(false);
                  resolve(true);
                } catch (err) {
                  console.error("Error processing local model:", err);
                  setIsModelLoading(false);
                  resolve(false);
                }
              },
              (progress) => {
                console.log("Loading progress:", progress);
              },
              (error) => {
                console.error("Error loading local model:", error);
                setIsModelLoading(false);
                resolve(false);
              }
            );
          } else {
            // 处理外部URL的模型（使用现有的代理逻辑）
            fetch("/api/proxy-model", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ url: urlToLoad }),
            })
              .then((response) => {
                if (!response.ok) {
                  throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.arrayBuffer();
              })
              .then((buffer) => {
                console.log(
                  "Received model buffer, size:",
                  buffer.byteLength,
                  "bytes"
                );
                loader.parse(
                  buffer,
                  "",
                  (gltf) => {
                    try {
                      console.log("Model parsed successfully:", gltf);
                      const model = gltf.scene;

                      const boundingBox = new THREE.Box3().setFromObject(model);
                      const size = boundingBox.getSize(new THREE.Vector3());
                      const modelHeight = size.y;

                      autoScaleModel(model, modelSize || 5);

                      // 硬编码：模型底部与地面对齐，并且高度提高 z/2（这里理解为高度的一半）
                      const position = {
                        x: 0,
                        y: modelHeight / 2 + modelHeight / 2,
                        z: 0,
                      };
                      model.position.set(position.x, position.y, position.z);

                      const modelId = `model_${Date.now()}`;
                      model.userData.modelId = modelId;
                      model.userData.isModelObject = true;
                      model.userData.originalModelUrl = modelUrl;
                      model.userData.originalUrl = modelUrl;
                      model.userData.selectable = true; // 明确标记为可选择对象
                      model.userData.isRemoteModel = true; // 标记为远程模型
                      model.name =
                        modelUrl.split("/").pop()?.split(".")[0] ||
                        `model_${Date.now()}`;

                      model.traverse((node: THREE.Object3D) => {
                        if ((node as THREE.Mesh).isMesh) {
                          console.log(
                            "Applied shadows to mesh:",
                            (node as THREE.Mesh).name || "unnamed mesh"
                          );
                          (node as THREE.Mesh).castShadow = true;
                          (node as THREE.Mesh).receiveShadow = true;
                          node.userData.modelId = modelId;
                          node.userData.originalModelUrl = modelUrl;
                          // 确保子网格不会被误认为是helper对象
                          node.userData.isHelper = false;
                          node.userData.isOutline = false;
                        }
                      });

                      // 将模型添加到dynamicGroup而不是直接添加到scene，以便ObjectManipulationControls可以操控
                      if (dynamicGroup) {
                        dynamicGroup.add(model);
                        console.log(
                          "Model added to dynamicGroup with position:",
                          model.position
                        );
                      } else {
                        scene.add(model);
                        console.log(
                          "Model added to scene (fallback) with position:",
                          model.position
                        );
                      }

                      fitCameraToModel(camera, model);

                      if (registerObject) {
                        const uuid = registerObject(model, "GLTFModel", {
                          originalUrl: modelUrl,
                          loadTimestamp: Date.now(),
                          modelSize: modelSize || 5,
                          isLoadedModel: true,
                          modelId: modelId,
                          originalModelUrl: modelUrl,
                        });
                        console.log(
                          `模型已注册到场景状态管理器，UUID: ${uuid}`
                        );
                      }

                      setLoadedModels((prev) => [
                        ...prev,
                        { id: modelId, url: urlToLoad },
                      ]);

                      console.log("Model loaded successfully through proxy");
                      setIsModelLoading(false);
                      resolve(true);
                    } catch (err) {
                      console.error("Error processing model data:", err);
                      setIsModelLoading(false);
                      resolve(false);
                    }
                  },
                  (event: ErrorEvent) => {
                    console.error("Error loading model:", event);
                    setIsModelLoading(false);
                    resolve(false);
                  }
                );
              })
              .catch((err) => {
                console.error("Error fetching model:", err);
                setIsModelLoading(false);
                resolve(false);
              });
          }
        });
      } catch (err) {
        console.error("Error initiating model load:", err);
        setIsModelLoading(false);
        return false;
      }
    },
    [threeRef, loadedModels, registerObject, fitCameraToModel, autoScaleModel]
  );

  return {
    loadedModels,
    isModelLoading,
    allModelUrls,
    setAllModelUrls,
    loadModel,
    autoScaleModel,
  };
};
