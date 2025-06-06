import React, { useState, useCallback } from "react";
import Head from "next/head";
import { useSceneStore } from "../stores/useSceneStore";
import PhysicsLabInterface from "../components/physics/PhysicsLabInterface";
import ThreeCodeEditor from "../components/ThreeCodeEditor";

// 物理实验数据类型
interface PhysicsExperiment {
  id: string;
  name: string;
  description: string;
  concept: string;
  complexity: "beginner" | "intermediate" | "advanced";
  icon: string;
  templateName: string;
}

export default function PhysicsLab() {
  const { setCurrentPrompt } = useSceneStore();
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedExperiment, setSelectedExperiment] =
    useState<PhysicsExperiment | null>(null);

  // 处理预设实验选择
  const handleExperimentSelect = useCallback(
    async (experiment: PhysicsExperiment) => {
      setIsGenerating(true);
      setSelectedExperiment(experiment);

      try {
        // 构建物理实验提示词
        const physicsPrompt = `加载物理实验模板: ${experiment.templateName}
      
实验名称: ${experiment.name}
实验描述: ${experiment.description}
核心概念: ${experiment.concept}
复杂度: ${experiment.complexity}

请使用 load_physics_template 工具加载这个物理实验模板，并确保:
1. 包含完整的Rapier物理引擎集成
2. 添加教育性标签和说明
3. 设置适当的物理参数
4. 确保场景具有教育价值`;

        setCurrentPrompt(physicsPrompt);

        // 这里可以触发AI代理处理
        console.log("物理实验选择:", experiment);
      } catch (error) {
        console.error("物理实验加载失败:", error);
      } finally {
        setIsGenerating(false);
      }
    },
    [setCurrentPrompt]
  );

  // 处理物理参数调整
  const handleParameterChange = useCallback(
    async (parameterId: string, value: number) => {
      setIsGenerating(true);

      try {
        // 构建参数调整提示词
        const parameterPrompt = `调整物理参数: ${parameterId} = ${value}

请使用 control_physics_parameters 工具调整场景中的物理参数:
- 参数类型: ${parameterId}
- 新数值: ${value}
- 包含教育说明，解释这个参数的物理意义
- 如果可能，添加对比演示显示参数变化的效果`;

        setCurrentPrompt(parameterPrompt);

        console.log("物理参数调整:", parameterId, value);
      } catch (error) {
        console.error("物理参数调整失败:", error);
      } finally {
        setIsGenerating(false);
      }
    },
    [setCurrentPrompt]
  );

  // 处理自定义物理场景
  const handleCustomPrompt = useCallback(
    async (prompt: string) => {
      setIsGenerating(true);

      try {
        // 构建自定义物理场景提示词
        const customPhysicsPrompt = `创建自定义物理教育场景:

用户需求: ${prompt}

请使用 generate_physics_scene 工具创建这个物理场景，要求:
1. 包含完整的Rapier物理引擎集成
2. 根据描述确定合适的物理概念类型
3. 添加教育性标签和说明文字
4. 设置合适的复杂度和物体数量
5. 确保物理仿真的准确性和教育价值
6. 包含交互控制元素，让学生可以观察和实验`;

        setCurrentPrompt(customPhysicsPrompt);

        console.log("自定义物理场景:", prompt);
      } catch (error) {
        console.error("自定义物理场景创建失败:", error);
      } finally {
        setIsGenerating(false);
      }
    },
    [setCurrentPrompt]
  );

  return (
    <>
      <Head>
        <title>物理实验室 - 3D Physics Education Platform</title>
        <meta
          name="description"
          content="交互式3D物理实验室，通过Rapier物理引擎学习物理概念"
        />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="min-h-screen bg-black text-white">
        {/* 头部导航 */}
        <header className="border-b border-gray-800 bg-black/95 backdrop-blur-sm sticky top-0 z-50">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <h1 className="text-xl font-bold">🧪 物理实验室</h1>
                <span className="text-gray-400">|</span>
                <span className="text-sm text-gray-400">
                  AI驱动的3D物理教育平台
                </span>
              </div>

              <div className="flex items-center space-x-4">
                {selectedExperiment && (
                  <div className="flex items-center space-x-2 px-3 py-1 bg-gray-900 rounded-full">
                    <span className="text-lg">{selectedExperiment.icon}</span>
                    <span className="text-sm">{selectedExperiment.name}</span>
                  </div>
                )}

                <nav className="flex items-center space-x-4">
                  <a
                    href="/"
                    className="text-gray-400 hover:text-white transition-colors text-sm"
                  >
                    返回编辑器
                  </a>
                  <a
                    href="/physics-lab"
                    className="text-white font-medium text-sm"
                  >
                    物理实验室
                  </a>
                </nav>
              </div>
            </div>
          </div>
        </header>

        {/* 主要内容区域 */}
        <div className="container mx-auto px-4 py-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* 左侧 - 物理实验控制面板 */}
            <div className="lg:col-span-1">
              <PhysicsLabInterface
                onExperimentSelect={handleExperimentSelect}
                onParameterChange={handleParameterChange}
                onCustomPrompt={handleCustomPrompt}
                isLoading={isGenerating}
              />

              {/* 学习指南 */}
              <div className="mt-6 bg-gray-900/50 border border-gray-800 rounded-lg p-4">
                <h3 className="text-lg font-semibold text-white mb-3">
                  📚 学习指南
                </h3>
                <div className="space-y-3 text-sm text-gray-400">
                  <div>
                    <h4 className="text-white font-medium">1. 选择实验</h4>
                    <p>从预设实验中选择感兴趣的物理概念</p>
                  </div>
                  <div>
                    <h4 className="text-white font-medium">2. 观察现象</h4>
                    <p>注意物体的运动和相互作用</p>
                  </div>
                  <div>
                    <h4 className="text-white font-medium">3. 调整参数</h4>
                    <p>改变物理参数看效果如何变化</p>
                  </div>
                  <div>
                    <h4 className="text-white font-medium">4. 理解原理</h4>
                    <p>阅读标签和说明理解背后的物理原理</p>
                  </div>
                </div>
              </div>

              {/* 物理概念速查 */}
              <div className="mt-4 bg-gray-900/50 border border-gray-800 rounded-lg p-4">
                <h3 className="text-lg font-semibold text-white mb-3">
                  ⚡ 物理概念
                </h3>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    { name: "重力", desc: "g = 9.81 m/s²" },
                    { name: "摩擦力", desc: "f = μN" },
                    { name: "弹性碰撞", desc: "e = 1" },
                    { name: "动量守恒", desc: "Σp = 常数" },
                    { name: "能量守恒", desc: "E = Ek + Ep" },
                    { name: "简谐振动", desc: "T = 2π√(m/k)" },
                  ].map((concept, index) => (
                    <div key={index} className="p-2 bg-gray-800 rounded">
                      <div className="text-white font-medium">
                        {concept.name}
                      </div>
                      <div className="text-gray-400">{concept.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 右侧 - 3D场景编辑器 */}
            <div className="lg:col-span-2">
              <div className="bg-gray-900/50 border border-gray-800 rounded-lg overflow-hidden">
                <div className="p-4 border-b border-gray-800 bg-gray-900/80">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-white">
                      🎭 3D物理场景
                    </h2>
                    <div className="flex items-center space-x-3">
                      {isGenerating && (
                        <div className="flex items-center space-x-2">
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          <span className="text-sm text-gray-400">
                            生成中...
                          </span>
                        </div>
                      )}
                      <div className="text-sm text-gray-400">
                        AI物理引擎驱动
                      </div>
                    </div>
                  </div>
                </div>

                {/* Three.js编辑器 */}
                <div className="h-[600px]">
                  <ThreeCodeEditor />
                </div>
              </div>

              {/* 实验说明区域 */}
              {selectedExperiment && (
                <div className="mt-4 bg-gray-900/50 border border-gray-800 rounded-lg p-4">
                  <div className="flex items-start space-x-3">
                    <div className="text-2xl">{selectedExperiment.icon}</div>
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-white mb-2">
                        {selectedExperiment.name}
                      </h3>
                      <p className="text-gray-400 mb-3">
                        {selectedExperiment.description}
                      </p>
                      <div className="flex items-center space-x-4 text-sm">
                        <div>
                          <span className="text-gray-500">核心概念: </span>
                          <span className="text-white">
                            {selectedExperiment.concept}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-500">复杂度: </span>
                          <span
                            className={`px-2 py-1 rounded text-xs ${
                              selectedExperiment.complexity === "beginner"
                                ? "bg-green-400/20 text-green-400"
                                : selectedExperiment.complexity ===
                                  "intermediate"
                                ? "bg-yellow-400/20 text-yellow-400"
                                : "bg-red-400/20 text-red-400"
                            }`}
                          >
                            {selectedExperiment.complexity}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 页脚 */}
        <footer className="border-t border-gray-800 bg-gray-900/50 mt-12">
          <div className="container mx-auto px-4 py-6">
            <div className="text-center text-gray-400 text-sm">
              <p>🚀 基于 Three.js + Rapier 物理引擎 | AI 驱动的物理教育平台</p>
              <p className="mt-1">通过交互式3D仿真学习物理概念</p>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
