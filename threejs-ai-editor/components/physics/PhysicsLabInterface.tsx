import React, { useState } from "react";
import { motion } from "framer-motion";

// 物理实验类型定义
interface PhysicsExperiment {
  id: string;
  name: string;
  description: string;
  concept: string;
  complexity: "beginner" | "intermediate" | "advanced";
  icon: string;
  templateName: string;
}

// 物理参数定义
interface PhysicsParameter {
  id: string;
  name: string;
  description: string;
  min: number;
  max: number;
  default: number;
  step: number;
  unit: string;
}

// 预设的物理实验
const PHYSICS_EXPERIMENTS: PhysicsExperiment[] = [
  {
    id: "gravity",
    name: "重力实验",
    description: "探索不同质量物体的自由落体运动",
    concept: "重力加速度对所有物体都相同",
    complexity: "beginner",
    icon: "⬇️",
    templateName: "gravity_demo",
  },
  {
    id: "collision",
    name: "碰撞实验室",
    description: "观察弹性和非弹性碰撞的区别",
    concept: "动量守恒定律",
    complexity: "intermediate",
    icon: "💥",
    templateName: "collision_lab",
  },
  {
    id: "friction",
    name: "摩擦力实验",
    description: "研究不同表面的摩擦效应",
    concept: "摩擦力对运动的影响",
    complexity: "intermediate",
    icon: "🛤️",
    templateName: "friction_experiment",
  },
  {
    id: "pendulum",
    name: "钟摆运动",
    description: "观察单摆的周期性运动",
    concept: "简谐振动和能量转换",
    complexity: "advanced",
    icon: "⏰",
    templateName: "pendulum_motion",
  },
];

// 物理参数配置
const PHYSICS_PARAMETERS: PhysicsParameter[] = [
  {
    id: "gravity",
    name: "重力加速度",
    description: "调整重力大小 (地球标准: 9.81)",
    min: 0,
    max: 20,
    default: 9.81,
    step: 0.1,
    unit: "m/s²",
  },
  {
    id: "friction",
    name: "摩擦系数",
    description: "表面摩擦程度 (0=无摩擦, 1=高摩擦)",
    min: 0,
    max: 1,
    default: 0.3,
    step: 0.05,
    unit: "",
  },
  {
    id: "restitution",
    name: "弹性系数",
    description: "物体弹性程度 (0=完全非弹性, 1=完全弹性)",
    min: 0,
    max: 1.5,
    default: 0.7,
    step: 0.1,
    unit: "",
  },
];

interface PhysicsLabInterfaceProps {
  onExperimentSelect: (experiment: PhysicsExperiment) => void;
  onParameterChange: (parameterId: string, value: number) => void;
  onCustomPrompt: (prompt: string) => void;
  isLoading?: boolean;
}

export default function PhysicsLabInterface({
  onExperimentSelect,
  onParameterChange,
  onCustomPrompt,
  isLoading = false,
}: PhysicsLabInterfaceProps) {
  const [selectedExperiment, setSelectedExperiment] = useState<string | null>(
    null
  );
  const [parameters, setParameters] = useState<Record<string, number>>(
    PHYSICS_PARAMETERS.reduce((acc, param) => {
      acc[param.id] = param.default;
      return acc;
    }, {} as Record<string, number>)
  );
  const [customPrompt, setCustomPrompt] = useState("");
  const [activeTab, setActiveTab] = useState<
    "experiments" | "parameters" | "custom"
  >("experiments");

  const handleExperimentClick = (experiment: PhysicsExperiment) => {
    setSelectedExperiment(experiment.id);
    onExperimentSelect(experiment);
  };

  const handleParameterChange = (parameterId: string, value: number) => {
    setParameters((prev) => ({ ...prev, [parameterId]: value }));
    onParameterChange(parameterId, value);
  };

  const handleCustomSubmit = () => {
    if (customPrompt.trim()) {
      onCustomPrompt(customPrompt.trim());
    }
  };

  const getComplexityColor = (complexity: string) => {
    switch (complexity) {
      case "beginner":
        return "text-green-400 bg-green-400/10";
      case "intermediate":
        return "text-yellow-400 bg-yellow-400/10";
      case "advanced":
        return "text-red-400 bg-red-400/10";
      default:
        return "text-gray-400 bg-gray-400/10";
    }
  };

  return (
    <div className="bg-black/90 border border-gray-800 rounded-lg p-6 space-y-6">
      {/* 标题 */}
      <div className="text-center">
        <h2 className="text-2xl font-bold text-white mb-2">🧪 物理实验室</h2>
        <p className="text-gray-400">探索物理世界的奥秘</p>
      </div>

      {/* 标签导航 */}
      <div className="flex space-x-1 bg-gray-900 rounded-lg p-1">
        {[
          { id: "experiments", label: "预设实验", icon: "🔬" },
          { id: "parameters", label: "参数控制", icon: "🎛️" },
          { id: "custom", label: "自定义", icon: "✍️" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as never)}
            className={`flex-1 flex items-center justify-center space-x-2 px-4 py-2 rounded-md transition-all ${
              activeTab === tab.id
                ? "bg-white text-black"
                : "text-gray-400 hover:text-white hover:bg-gray-800"
            }`}
          >
            <span>{tab.icon}</span>
            <span className="text-sm font-medium">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* 内容区域 */}
      <div className="min-h-[400px]">
        {/* 预设实验 */}
        {activeTab === "experiments" && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white mb-4">
              选择物理实验
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {PHYSICS_EXPERIMENTS.map((experiment) => (
                <motion.div
                  key={experiment.id}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className={`p-4 rounded-lg border cursor-pointer transition-all ${
                    selectedExperiment === experiment.id
                      ? "border-white bg-white/5"
                      : "border-gray-700 hover:border-gray-600 bg-gray-900/50"
                  }`}
                  onClick={() => handleExperimentClick(experiment)}
                >
                  <div className="flex items-start space-x-3">
                    <div className="text-2xl">{experiment.icon}</div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-semibold text-white">
                          {experiment.name}
                        </h4>
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${getComplexityColor(
                            experiment.complexity
                          )}`}
                        >
                          {experiment.complexity}
                        </span>
                      </div>
                      <p className="text-sm text-gray-400 mb-2">
                        {experiment.description}
                      </p>
                      <div className="text-xs text-gray-500">
                        <strong>核心概念:</strong> {experiment.concept}
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* 参数控制 */}
        {activeTab === "parameters" && (
          <div className="space-y-6">
            <h3 className="text-lg font-semibold text-white mb-4">
              物理参数调节
            </h3>
            {PHYSICS_PARAMETERS.map((param) => (
              <div key={param.id} className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-white font-medium">{param.name}</label>
                  <span className="text-gray-400 text-sm">
                    {parameters[param.id]?.toFixed(2)} {param.unit}
                  </span>
                </div>
                <input
                  type="range"
                  min={param.min}
                  max={param.max}
                  step={param.step}
                  value={parameters[param.id] || param.default}
                  onChange={(e) =>
                    handleParameterChange(param.id, parseFloat(e.target.value))
                  }
                  className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, #ffffff 0%, #ffffff ${
                      (((parameters[param.id] || param.default) - param.min) /
                        (param.max - param.min)) *
                      100
                    }%, #374151 ${
                      (((parameters[param.id] || param.default) - param.min) /
                        (param.max - param.min)) *
                      100
                    }%, #374151 100%)`,
                  }}
                />
                <p className="text-xs text-gray-500">{param.description}</p>
              </div>
            ))}

            <div className="mt-6 p-4 bg-gray-900 rounded-lg">
              <h4 className="text-sm font-semibold text-white mb-2">
                💡 实验建议
              </h4>
              <ul className="text-xs text-gray-400 space-y-1">
                <li>• 调整重力观察物体下落速度变化</li>
                <li>• 增加摩擦系数看物体滑动距离</li>
                <li>• 改变弹性系数观察反弹高度</li>
              </ul>
            </div>
          </div>
        )}

        {/* 自定义实验 */}
        {activeTab === "custom" && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white mb-4">
              自定义物理场景
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-white mb-2">
                  描述你想要的物理实验或现象
                </label>
                <textarea
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="例如: 创建一个展示能量守恒的实验，包含一个从高处滚下的小球..."
                  className="w-full h-32 px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:border-white focus:ring-1 focus:ring-white resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-white mb-2">
                    复杂度
                  </label>
                  <select className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:border-white">
                    <option value="beginner">初级 - 基础概念</option>
                    <option value="intermediate">中级 - 多个概念</option>
                    <option value="advanced">高级 - 复杂交互</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-white mb-2">
                    物体数量
                  </label>
                  <select className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:border-white">
                    <option value="1-3">1-3 个物体</option>
                    <option value="4-6">4-6 个物体</option>
                    <option value="7-10">7-10 个物体</option>
                  </select>
                </div>
              </div>

              <button
                onClick={handleCustomSubmit}
                disabled={!customPrompt.trim() || isLoading}
                className="w-full px-4 py-3 bg-white text-black font-semibold rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isLoading ? "正在创建实验..." : "🚀 创建自定义实验"}
              </button>
            </div>

            <div className="mt-6 p-4 bg-gray-900 rounded-lg">
              <h4 className="text-sm font-semibold text-white mb-2">
                💭 创意提示
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-gray-400">
                <div>• 多个球从不同高度同时释放</div>
                <div>• 弹簧连接的振子系统</div>
                <div>• 不同材质的斜面对比</div>
                <div>• 液体中的浮力演示</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 状态指示器 */}
      {isLoading && (
        <div className="flex items-center justify-center py-4">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
          <span className="ml-2 text-gray-400">正在生成物理场景...</span>
        </div>
      )}
    </div>
  );
}
