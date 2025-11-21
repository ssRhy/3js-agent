import React, { useState, useRef, useCallback, useEffect } from "react";

interface ModelInfo {
  id: string;
  name: string;
  fileName: string;
  size: number;
  url: string;
  uploadDate: string;
  type: string;
}

interface ModelUploaderProps {
  onModelUploaded: (model: ModelInfo) => void;
  onModelLoad: (url: string) => void;
  className?: string;
}

const ModelUploader: React.FC<ModelUploaderProps> = ({
  onModelUploaded,
  onModelLoad,
  className = "",
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadedModels, setUploadedModels] = useState<ModelInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCountRef = useRef(0);

  // 加载已上传的模型列表
  const loadUploadedModels = useCallback(async () => {
    try {
      const response = await fetch("/api/models");
      if (response.ok) {
        const data = await response.json();
        setUploadedModels(data.models || []);
      }
    } catch (error) {
      console.error("Failed to load uploaded models:", error);
    }
  }, []);

  useEffect(() => {
    loadUploadedModels();
  }, [loadUploadedModels]);

  // 格式化文件大小
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  // 验证文件类型
  const validateFile = (file: File): { isValid: boolean; error?: string } => {
    const fileExtension = "." + file.name.split(".").pop()?.toLowerCase();
    const allowedTypes = [".glb", ".gltf"];

    if (!allowedTypes.includes(fileExtension)) {
      return {
        isValid: false,
        error: "Only GLB and GLTF files are supported",
      };
    }

    if (file.size > 50 * 1024 * 1024) {
      // 50MB
      return {
        isValid: false,
        error: "File size must be less than 50MB",
      };
    }

    return { isValid: true };
  };

  // 上传文件
  const uploadFile = async (file: File): Promise<void> => {
    setIsUploading(true);
    setError(null);
    setUploadProgress(0);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const xhr = new XMLHttpRequest();

      return new Promise((resolve, reject) => {
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const progress = (event.loaded / event.total) * 100;
            setUploadProgress(progress);
          }
        };

        xhr.onload = () => {
          if (xhr.status === 200) {
            const response = JSON.parse(xhr.responseText);
            if (response.success) {
              onModelUploaded(response.file);
              loadUploadedModels();
              resolve();
            } else {
              reject(new Error(response.error || "Upload failed"));
            }
          } else {
            const response = JSON.parse(xhr.responseText);
            reject(new Error(response.error || "Upload failed"));
          }
        };

        xhr.onerror = () => {
          reject(new Error("Upload failed"));
        };

        xhr.open("POST", "/api/upload-model");
        xhr.send(formData);
      });
    } catch (error) {
      throw error;
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  // 处理文件选择
  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const file = files[0];
    const validation = validateFile(file);

    if (!validation.isValid) {
      setError(validation.error || "Invalid file");
      return;
    }

    try {
      await uploadFile(file);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Upload failed");
    }
  };

  // 拖拽事件处理
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current++;
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current--;
    if (dragCountRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCountRef.current = 0;

    const files = e.dataTransfer.files;
    handleFileSelect(files);
  };

  // 删除模型
  const handleDeleteModel = async (fileName: string) => {
    try {
      const response = await fetch(
        `/api/models?fileName=${encodeURIComponent(fileName)}`,
        {
          method: "DELETE",
        }
      );

      if (response.ok) {
        loadUploadedModels();
      } else {
        const error = await response.json();
        setError(error.error || "Failed to delete model");
      }
    } catch (error) {
      setError("Failed to delete model");
    }
  };

  // 加载模型到场景
  const handleLoadModel = (model: ModelInfo) => {
    onModelLoad(model.url);
  };

  return (
    <div className={`model-uploader ${className}`}>
      <div className="upload-section">
        <div
          className={`upload-area ${isDragging ? "dragging" : ""} ${
            isUploading ? "uploading" : ""
          }`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".glb,.gltf"
            onChange={(e) => handleFileSelect(e.target.files)}
            style={{ display: "none" }}
          />

          {isUploading ? (
            <div className="upload-progress">
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <span className="progress-text">
                Uploading... {Math.round(uploadProgress)}%
              </span>
            </div>
          ) : (
            <div className="upload-content">
              <div className="upload-icon">UPLOAD</div>
              <div className="upload-text">
                <div className="upload-primary">Drop GLB/GLTF files here</div>
                <div className="upload-secondary">or click to browse</div>
              </div>
            </div>
          )}
        </div>

        {error && <div className="error-message">{error}</div>}
      </div>

      {/* 模型列表 */}
      <div className="files-section">
        <div className="files-header">
          <h3>Uploaded Models</h3>
          <span className="files-count">{uploadedModels.length}</span>
        </div>

        <div className="files-list">
          {uploadedModels.length === 0 ? (
            <div className="no-files">No models uploaded yet</div>
          ) : (
            uploadedModels.map((model) => (
              <div key={model.id} className="file-item">
                <div className="file-info">
                  <div className="file-name">{model.name}</div>
                  <div className="file-meta">
                    <span className="file-size">
                      {formatFileSize(model.size)}
                    </span>
                    <span className="file-type">
                      {model.type.toUpperCase()}
                    </span>
                  </div>
                </div>
                <div className="file-actions">
                  <button
                    className="btn-load"
                    onClick={() => handleLoadModel(model)}
                    title="Load model in scene"
                  >
                    Load
                  </button>
                  <button
                    className="btn-delete"
                    onClick={() => handleDeleteModel(model.fileName)}
                    title="Delete model"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <style jsx>{`
        .model-uploader {
          display: flex;
          flex-direction: column;
          gap: 24px;
          padding: 16px;
          background: var(--bg-card, #151515);
          border-radius: 8px;
          border: 1px solid var(--border-primary, #333333);
        }

        .tabs-navigation {
          display: flex;
          gap: 2px;
          background: var(--bg-tertiary, #2a2a2a);
          border-radius: 6px;
          padding: 2px;
        }

        .tab-button {
          flex: 1;
          padding: 8px 16px;
          border: none;
          background: transparent;
          color: var(--text-secondary, #a0a0a0);
          font-size: 14px;
          font-weight: 500;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .tab-button:hover {
          color: var(--text-primary, #ffffff);
          background: var(--bg-hover, #2d2d2d);
        }

        .tab-button.active {
          color: var(--text-primary, #ffffff);
          background: var(--bg-card, #151515);
          border: 1px solid var(--border-primary, #333333);
        }

        .upload-section {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .upload-area {
          border: 2px dashed var(--border-secondary, #404040);
          border-radius: 8px;
          padding: 32px 16px;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s ease;
          background: var(--bg-input, #0f0f0f);
          min-height: 120px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .upload-area:hover {
          border-color: var(--border-accent, #505050);
          background: var(--bg-hover, #2d2d2d);
        }

        .upload-area.dragging {
          border-color: var(--accent-primary, #ffffff);
          background: var(--bg-hover, #2d2d2d);
        }

        .upload-area.uploading {
          cursor: not-allowed;
          opacity: 0.8;
        }

        .upload-content {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }

        .upload-icon {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-secondary, #a0a0a0);
          letter-spacing: 0.5px;
          padding: 4px 8px;
          border: 1px solid var(--border-primary, #333333);
          border-radius: 4px;
          background: var(--bg-tertiary, #2a2a2a);
        }

        .upload-text {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .upload-primary {
          color: var(--text-primary, #ffffff);
          font-weight: 500;
        }

        .upload-secondary {
          color: var(--text-secondary, #a0a0a0);
          font-size: 14px;
        }

        .upload-progress {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          min-width: 200px;
        }

        .progress-bar {
          width: 100%;
          height: 4px;
          background: var(--bg-tertiary, #2a2a2a);
          border-radius: 2px;
          overflow: hidden;
        }

        .progress-fill {
          height: 100%;
          background: var(--accent-primary, #ffffff);
          transition: width 0.3s ease;
        }

        .progress-text {
          color: var(--text-secondary, #a0a0a0);
          font-size: 14px;
        }

        .error-message {
          padding: 8px 12px;
          background: #2d1a1a;
          border: 1px solid #5d2d2d;
          border-radius: 4px;
          color: #ff6b6b;
          font-size: 14px;
        }

        .files-section {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .files-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--border-primary, #333333);
        }

        .files-header h3 {
          margin: 0;
          font-size: 16px;
          font-weight: 500;
          color: var(--text-primary, #ffffff);
        }

        .files-count {
          background: var(--bg-tertiary, #2a2a2a);
          color: var(--text-secondary, #a0a0a0);
          padding: 2px 8px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 500;
        }

        .files-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-height: 300px;
          overflow-y: auto;
        }

        .no-files {
          text-align: center;
          color: var(--text-tertiary, #666666);
          padding: 24px;
          font-style: italic;
        }

        .file-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px;
          background: var(--bg-input, #0f0f0f);
          border-radius: 6px;
          border: 1px solid var(--border-primary, #333333);
          transition: all 0.2s ease;
        }

        .file-item:hover {
          border-color: var(--border-secondary, #404040);
          background: var(--bg-hover, #2d2d2d);
        }

        .file-item.image-item {
          align-items: flex-start;
          gap: 12px;
        }

        .image-preview {
          flex-shrink: 0;
          width: 60px;
          height: 60px;
          border-radius: 4px;
          overflow: hidden;
          background: var(--bg-tertiary, #2a2a2a);
          border: 1px solid var(--border-primary, #333333);
        }

        .image-preview img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .file-info {
          display: flex;
          flex-direction: column;
          gap: 4px;
          flex: 1;
        }

        .file-name {
          color: var(--text-primary, #ffffff);
          font-weight: 500;
          font-size: 14px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .file-meta {
          display: flex;
          gap: 12px;
          font-size: 12px;
          color: var(--text-secondary, #a0a0a0);
        }

        .file-actions {
          display: flex;
          gap: 8px;
          flex-shrink: 0;
        }

        .btn-load,
        .btn-delete,
        .btn-generate {
          padding: 4px 8px;
          border: 1px solid var(--border-primary, #333333);
          border-radius: 4px;
          background: var(--bg-input, #0f0f0f);
          color: var(--text-primary, #ffffff);
          font-size: 12px;
          cursor: pointer;
          transition: all 0.2s ease;
          white-space: nowrap;
        }

        .btn-load:hover,
        .btn-generate:hover {
          border-color: var(--accent-primary, #ffffff);
          background: var(--bg-hover, #2d2d2d);
        }

        .btn-generate:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .btn-generate:disabled:hover {
          border-color: var(--border-primary, #333333);
          background: var(--bg-input, #0f0f0f);
        }

        .btn-delete:hover {
          border-color: #ff6b6b;
          background: #2d1a1a;
          color: #ff6b6b;
        }

        .btn-load:active,
        .btn-delete:active,
        .btn-generate:active {
          transform: scale(0.95);
        }
      `}</style>
    </div>
  );
};

export default ModelUploader;
