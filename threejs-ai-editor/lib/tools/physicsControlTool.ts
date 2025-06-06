import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * 物理参数类型定义
 */
interface PhysicsParameters {
  gravity: { x: number; y: number; z: number };
  globalFriction: number;
  globalRestitution: number;
  timeScale: number;
  airDensity: number;
}

/**
 * 物理参数控制工具 - 动态调整物理场景中的参数
 */
export const physicsControlTool = new DynamicStructuredTool({
  name: "control_physics_parameters",
  description:
    "Dynamically control physics parameters in the scene. " +
    "Allows real-time adjustment of gravity, friction, restitution, and other physics properties for educational exploration.",
  schema: z.object({
    parameterType: z
      .enum([
        "gravity",
        "friction",
        "restitution",
        "timeScale",
        "airDensity",
        "objectSpecific",
      ])
      .describe("Type of physics parameter to control"),
    value: z
      .union([z.number(), z.array(z.number())])
      .describe("New value for the parameter"),
    objectId: z
      .string()
      .optional()
      .describe("Specific object ID for object-specific parameters"),
    animationDuration: z
      .number()
      .default(1000)
      .describe("Duration in ms for parameter transition"),
    explanation: z
      .string()
      .optional()
      .describe("Educational explanation of the physics concept"),
  }),
  func: async ({
    parameterType,
    value,
    objectId,
    animationDuration,
    explanation,
  }) => {
    const requestId = `physics_control_${Date.now()}`;
    console.log(
      `[${requestId}] [Physics Control Tool] 🎛️ Adjusting ${parameterType} parameter`
    );
    console.log(
      `[${requestId}] [Physics Control Tool] New value: ${JSON.stringify(
        value
      )}`
    );

    try {
      let controlCode = "";

      switch (parameterType) {
        case "gravity":
          const gravityVector = Array.isArray(value) ? value : [0, value, 0];
          controlCode = `
function setup(scene, camera, renderer, THREE, OrbitControls, RAPIER) {
  // 获取或创建物理世界
  let world = scene.userData.physicsWorld;
  if (!world) {
    world = new RAPIER.World({ x: ${gravityVector[0]}, y: ${
            gravityVector[1]
          }, z: ${gravityVector[2]} });
    scene.userData.physicsWorld = world;
  } else {
    // 更新重力
    world.gravity = { x: ${gravityVector[0]}, y: ${gravityVector[1]}, z: ${
            gravityVector[2]
          } };
  }
  
  // 创建重力指示器
  const arrowGeometry = new THREE.ConeGeometry(0.2, 1, 8);
  const arrowMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial);
  arrow.position.set(4, 2, 0);
  scene.add(arrow);
  
  ${
    explanation
      ? `
  // 教育说明
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.width = 512;
  canvas.height = 128;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000000';
  context.font = '20px Arial';
  context.textAlign = 'center';
  context.fillText("${explanation}", canvas.width / 2, canvas.height / 2);
  
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.MeshBasicMaterial({ map: texture });
  const geometry = new THREE.PlaneGeometry(3, 0.8);
  const textMesh = new THREE.Mesh(geometry, material);
  textMesh.position.set(0, 4, 0);
  scene.add(textMesh);
  `
      : ""
  }
  
  return scene;
}`;
          break;

        case "friction":
          controlCode = `
function setup(scene, camera, renderer, THREE, OrbitControls, RAPIER) {
  const newFriction = ${typeof value === "number" ? value : value[0]};
  
  // 更新所有物体的摩擦系数
  scene.traverse((child) => {
    if (child.userData.collider) {
      child.userData.collider.setFriction(newFriction);
    }
  });
  
  ${
    explanation
      ? `
  // 教育说明
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.width = 512;
  canvas.height = 128;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000000';
  context.font = '20px Arial';
  context.textAlign = 'center';
  context.fillText("${explanation}", canvas.width / 2, canvas.height / 2);
  
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.MeshBasicMaterial({ map: texture });
  const geometry = new THREE.PlaneGeometry(3, 0.8);
  const textMesh = new THREE.Mesh(geometry, material);
  textMesh.position.set(0, 3, 0);
  scene.add(textMesh);
  `
      : ""
  }
  
  return scene;
}`;
          break;

        default:
          controlCode = `
function setup(scene, camera, renderer, THREE, OrbitControls, RAPIER) {
  console.log("调整物理参数: ${parameterType} = ${JSON.stringify(value)}");
  return scene;
}`;
      }

      console.log(
        `[${requestId}] [Physics Control Tool] ✅ Generated control code`
      );
      return controlCode;
    } catch (error) {
      console.error(`[${requestId}] [Physics Control Tool] 🔴 Error:`, error);
      throw new Error(`Physics parameter control failed: ${error}`);
    }
  },
});

/**
 * 物理教育场景模板工具
 */
export const physicsTemplateTool = new DynamicStructuredTool({
  name: "load_physics_template",
  description:
    "Load pre-built physics education scene templates. " +
    "Provides quick access to common physics demonstrations and experiments.",
  schema: z.object({
    templateName: z
      .enum([
        "gravity_demo",
        "collision_lab",
        "friction_experiment",
        "pendulum_motion",
        "projectile_motion",
        "energy_conservation",
        "spring_oscillation",
        "momentum_conservation",
      ])
      .describe("Name of the physics template to load"),
    customization: z
      .object({
        objectCount: z.number().min(1).max(10).default(3),
        complexity: z
          .enum(["simple", "detailed", "advanced"])
          .default("detailed"),
        showLabels: z.boolean().default(true),
        enableInteraction: z.boolean().default(true),
      })
      .optional()
      .describe("Template customization options"),
  }),
  func: async ({ templateName, customization }) => {
    const requestId = `template_${Date.now()}`;
    console.log(
      `[${requestId}] [Physics Template Tool] 📚 Loading template: ${templateName}`
    );

    const config = customization || {};

    try {
      const templateCode = getPhysicsTemplate(templateName, config);
      console.log(
        `[${requestId}] [Physics Template Tool] ✅ Template loaded successfully`
      );
      return templateCode;
    } catch (error) {
      console.error(`[${requestId}] [Physics Template Tool] 🔴 Error:`, error);
      throw new Error(`Template loading failed: ${error}`);
    }
  },
});

/**
 * 通用物理函数库
 */
const commonFunctions = `
// 创建教育标签函数
function createLabel(scene, text, position) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.width = 256;
  canvas.height = 64;
  context.fillStyle = 'rgba(255, 255, 255, 0.9)';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000000';
  context.font = '16px Arial';
  context.textAlign = 'center';
  context.fillText(text, canvas.width / 2, canvas.height / 2);
  
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.MeshBasicMaterial({ 
    map: texture, 
    transparent: true 
  });
  const geometry = new THREE.PlaneGeometry(2, 0.5);
  const textMesh = new THREE.Mesh(geometry, material);
  textMesh.position.set(position.x, position.y, position.z);
  textMesh.lookAt(camera.position);
  scene.add(textMesh);
  return textMesh;
}

// 物理世界初始化函数
function initPhysicsWorld(gravity = { x: 0, y: -9.81, z: 0 }) {
  const world = new RAPIER.World(gravity);
  return world;
}

// 物理体同步函数
function syncPhysicsToGraphics(meshes, bodies) {
  for (let i = 0; i < meshes.length; i++) {
    if (bodies[i]) {
      const position = bodies[i].translation();
      const rotation = bodies[i].rotation();
      meshes[i].position.copy(position);
      meshes[i].quaternion.copy(rotation);
    }
  }
}
`;

/**
 * 获取物理教育场景模板
 */
function getPhysicsTemplate(templateName: string, config: any): string {
  const baseSetup = `
function setup(scene, camera, renderer, THREE, OrbitControls, RAPIER) {
  // 初始化Rapier物理世界
  const world = new RAPIER.World({ x: 0.0, y: -9.81, z: 0.0 });
  scene.userData.physicsWorld = world;
  
  // 添加基础照明
  const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
  scene.add(ambientLight);
  
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(10, 10, 5);
  directionalLight.castShadow = true;
  scene.add(directionalLight);
  
  // 设置相机位置
  camera.position.set(8, 6, 8);
  camera.lookAt(0, 0, 0);
`;

  switch (templateName) {
    case "gravity_demo":
      return (
        baseSetup +
        `
  // 重力演示 - 不同质量物体的自由落体
  
  // 创建地面
  const groundGeometry = new THREE.BoxGeometry(10, 0.2, 10);
  const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x808080 });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.position.y = -1;
  scene.add(ground);
  
  // 创建地面刚体
  const groundRigidBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1, 0);
  const groundRigidBody = world.createRigidBody(groundRigidBodyDesc);
  const groundColliderDesc = RAPIER.ColliderDesc.cuboid(5, 0.1, 5);
  world.createCollider(groundColliderDesc, groundRigidBody);
  
  // 创建不同大小的球体展示重力效果
  const sphereGeometry1 = new THREE.SphereGeometry(0.3, 16, 16);
  const sphereGeometry2 = new THREE.SphereGeometry(0.5, 16, 16);
  const sphereGeometry3 = new THREE.SphereGeometry(0.7, 16, 16);
  
  const materials = [
    new THREE.MeshLambertMaterial({ color: 0xff0000 }),
    new THREE.MeshLambertMaterial({ color: 0x00ff00 }),
    new THREE.MeshLambertMaterial({ color: 0x0000ff })
  ];
  
  const spheres = [];
  const rigidBodies = [];
  
  // 小球
  const sphere1 = new THREE.Mesh(sphereGeometry1, materials[0]);
  sphere1.position.set(-2, 5, 0);
  sphere1.castShadow = true;
  scene.add(sphere1);
  spheres.push(sphere1);
  
  const rigidBodyDesc1 = RAPIER.RigidBodyDesc.dynamic().setTranslation(-2, 5, 0);
  const rigidBody1 = world.createRigidBody(rigidBodyDesc1);
  const colliderDesc1 = RAPIER.ColliderDesc.ball(0.3).setRestitution(0.7);
  world.createCollider(colliderDesc1, rigidBody1);
  rigidBodies.push(rigidBody1);
  
  // 中球
  const sphere2 = new THREE.Mesh(sphereGeometry2, materials[1]);
  sphere2.position.set(0, 5, 0);
  sphere2.castShadow = true;
  scene.add(sphere2);
  spheres.push(sphere2);
  
  const rigidBodyDesc2 = RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 5, 0);
  const rigidBody2 = world.createRigidBody(rigidBodyDesc2);
  const colliderDesc2 = RAPIER.ColliderDesc.ball(0.5).setRestitution(0.7);
  world.createCollider(colliderDesc2, rigidBody2);
  rigidBodies.push(rigidBody2);
  
  // 大球
  const sphere3 = new THREE.Mesh(sphereGeometry3, materials[2]);
  sphere3.position.set(2, 5, 0);
  sphere3.castShadow = true;
  scene.add(sphere3);
  spheres.push(sphere3);
  
  const rigidBodyDesc3 = RAPIER.RigidBodyDesc.dynamic().setTranslation(2, 5, 0);
  const rigidBody3 = world.createRigidBody(rigidBodyDesc3);
  const colliderDesc3 = RAPIER.ColliderDesc.ball(0.7).setRestitution(0.7);
  world.createCollider(colliderDesc3, rigidBody3);
  rigidBodies.push(rigidBody3);
  
  ${
    config.showLabels
      ? `
  // 添加教育标签
  createLabel(scene, "重力演示：不同质量物体的自由落体", { x: 0, y: 6, z: 0 });
  createLabel(scene, "小球(轻)", { x: -2, y: 3, z: 0 });
  createLabel(scene, "中球(中)", { x: 0, y: 3, z: 0 });
  createLabel(scene, "大球(重)", { x: 2, y: 3, z: 0 });
  `
      : ""
  }
  
  // 物理模拟循环
  function animate() {
    world.step();
    
    // 同步Three.js对象与物理对象的位置
    for (let i = 0; i < spheres.length; i++) {
      const position = rigidBodies[i].translation();
      const rotation = rigidBodies[i].rotation();
      
      spheres[i].position.copy(position);
      spheres[i].quaternion.copy(rotation);
    }
    
    requestAnimationFrame(animate);
  }
  animate();
  
  return scene;
}

${commonFunctions}
`
      );

    case "collision_lab":
      return (
        baseSetup +
        `
  // 碰撞实验室 - 弹性和非弹性碰撞对比
  
  // 创建地面
  const groundGeometry = new THREE.BoxGeometry(12, 0.2, 8);
  const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x808080 });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.position.y = -1;
  scene.add(ground);
  
  // 地面物理体
  const groundRigidBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1, 0);
  const groundRigidBody = world.createRigidBody(groundRigidBodyDesc);
  const groundColliderDesc = RAPIER.ColliderDesc.cuboid(6, 0.1, 4);
  world.createCollider(groundColliderDesc, groundRigidBody);
  
  // 弹性碰撞区域
  const elasticBalls = [];
  const elasticBodies = [];
  
  // 运动球1 (弹性碰撞)
  const elasticGeometry = new THREE.SphereGeometry(0.4, 16, 16);
  const elasticMaterial1 = new THREE.MeshLambertMaterial({ color: 0xff0000 });
  const elasticBall1 = new THREE.Mesh(elasticGeometry, elasticMaterial1);
  elasticBall1.position.set(-4, 2, 1);
  scene.add(elasticBall1);
  elasticBalls.push(elasticBall1);
  
  const elasticBodyDesc1 = RAPIER.RigidBodyDesc.dynamic().setTranslation(-4, 2, 1);
  const elasticBody1 = world.createRigidBody(elasticBodyDesc1);
  elasticBody1.setLinvel({ x: 3, y: 0, z: 0 }, true);
  const elasticColliderDesc1 = RAPIER.ColliderDesc.ball(0.4).setRestitution(0.9).setFriction(0.1);
  world.createCollider(elasticColliderDesc1, elasticBody1);
  elasticBodies.push(elasticBody1);
  
  // 静止球1 (弹性碰撞)
  const elasticMaterial2 = new THREE.MeshLambertMaterial({ color: 0xff6666 });
  const elasticBall2 = new THREE.Mesh(elasticGeometry, elasticMaterial2);
  elasticBall2.position.set(-1, 2, 1);
  scene.add(elasticBall2);
  elasticBalls.push(elasticBall2);
  
  const elasticBodyDesc2 = RAPIER.RigidBodyDesc.dynamic().setTranslation(-1, 2, 1);
  const elasticBody2 = world.createRigidBody(elasticBodyDesc2);
  const elasticColliderDesc2 = RAPIER.ColliderDesc.ball(0.4).setRestitution(0.9).setFriction(0.1);
  world.createCollider(elasticColliderDesc2, elasticBody2);
  elasticBodies.push(elasticBody2);
  
  // 非弹性碰撞区域
  const inelasticBalls = [];
  const inelasticBodies = [];
  
  // 运动球2 (非弹性碰撞)
  const inelasticMaterial1 = new THREE.MeshLambertMaterial({ color: 0x0000ff });
  const inelasticBall1 = new THREE.Mesh(elasticGeometry, inelasticMaterial1);
  inelasticBall1.position.set(-4, 2, -1);
  scene.add(inelasticBall1);
  inelasticBalls.push(inelasticBall1);
  
  const inelasticBodyDesc1 = RAPIER.RigidBodyDesc.dynamic().setTranslation(-4, 2, -1);
  const inelasticBody1 = world.createRigidBody(inelasticBodyDesc1);
  inelasticBody1.setLinvel({ x: 3, y: 0, z: 0 }, true);
  const inelasticColliderDesc1 = RAPIER.ColliderDesc.ball(0.4).setRestitution(0.1).setFriction(0.8);
  world.createCollider(inelasticColliderDesc1, inelasticBody1);
  inelasticBodies.push(inelasticBody1);
  
  // 静止球2 (非弹性碰撞)
  const inelasticMaterial2 = new THREE.MeshLambertMaterial({ color: 0x6666ff });
  const inelasticBall2 = new THREE.Mesh(elasticGeometry, inelasticMaterial2);
  inelasticBall2.position.set(-1, 2, -1);
  scene.add(inelasticBall2);
  inelasticBalls.push(inelasticBall2);
  
  const inelasticBodyDesc2 = RAPIER.RigidBodyDesc.dynamic().setTranslation(-1, 2, -1);
  const inelasticBody2 = world.createRigidBody(inelasticBodyDesc2);
  const inelasticColliderDesc2 = RAPIER.ColliderDesc.ball(0.4).setRestitution(0.1).setFriction(0.8);
  world.createCollider(inelasticColliderDesc2, inelasticBody2);
  inelasticBodies.push(inelasticBody2);
  
  ${
    config.showLabels
      ? `
  // 添加教育标签
  createLabel(scene, "碰撞实验室", { x: 0, y: 4, z: 0 });
  createLabel(scene, "弹性碰撞", { x: -2.5, y: 3, z: 1 });
  createLabel(scene, "非弹性碰撞", { x: -2.5, y: 3, z: -1 });
  `
      : ""
  }
  
  // 物理模拟循环
  const allBalls = [...elasticBalls, ...inelasticBalls];
  const allBodies = [...elasticBodies, ...inelasticBodies];
  
  function animate() {
    world.step();
    
    // 同步位置
    for (let i = 0; i < allBalls.length; i++) {
      const position = allBodies[i].translation();
      const rotation = allBodies[i].rotation();
      
      allBalls[i].position.copy(position);
      allBalls[i].quaternion.copy(rotation);
    }
    
    requestAnimationFrame(animate);
  }
  animate();
  
  return scene;
}

${commonFunctions}
`
      );

    default:
      return (
        baseSetup +
        `
  // 基础物理场景模板
  console.log("加载物理模板: ${templateName}");
  
  return scene;
}

${commonFunctions}
`
      );
  }
}
