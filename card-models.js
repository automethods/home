import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { t } from './i18n.js?v=0.5.23';
import { addBusLights } from './bus-lights.js';

const loader = new GLTFLoader();
const assets = new Map();
function getModel(file) {
  const revision = file === 'commercial-fleet' ? '?v=0.2.2' : file === 'obd-diagnostics' ? '?v=0.5.16.1' : '';
  if (!assets.has(file)) assets.set(file, loader.loadAsync(`models/${file}.glb${revision}`).then(gltf => {
    return gltf.scene;
  }).catch(error => { assets.delete(file); throw error; }));
  return assets.get(file).then(root => root.clone(true));
}
function normalize(root, length) {
  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const group = new THREE.Group();
  group.add(root);
  root.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z));
  group.scale.setScalar(length / Math.max(size.x, size.y, size.z));
  return group;
}

async function serviceBay(viewport) {
  const project = viewport.closest('.card').querySelector('.action').href;
  const { MeshoptDecoder } = await import(new URL('vendor/three/libs/meshopt_decoder.module.js', project));
  const workshopLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const load = (file, revision = '') => workshopLoader.loadAsync(new URL(`models/${file}.glb${revision}`, project).href);
  const [car, lift, changer] = await Promise.all([
    load('tesla-lift'), load('lift-ukrainian', '?v=native-controls'), load('tyre-changer'),
  ]);
  const bay = new THREE.Group();
  const vehicle = normalize(car.scene, 4.69);
  lift.scene.rotation.y = Math.PI / 2;
  lift.scene.position.x = -0.65;
  vehicle.position.x = -0.65;
  const tyreChanger = normalize(changer.scene, 1.9);
  tyreChanger.position.set(2.55, 0, 1.25);
  bay.add(vehicle, lift.scene, tyreChanger);
  return normalize(bay, 4);
}

async function createView(viewport) {
  const status = viewport.querySelector('.model-status');
  const key = viewport.dataset.scene;
  let statusKey = `loading${key[0].toUpperCase()}${key.slice(1)}`;
  function translate() {
    status.textContent = statusKey ? t(statusKey) : '';
  }
  document.addEventListener('languagechange', translate);
  translate();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  viewport.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xe5f4ff, 0x607581, 2.5));
  for (const [position, strength] of [[[3, 5, 4], 3], [[-3, 3, -4], 2]]) {
    const light = new THREE.DirectionalLight(0xffffff, strength);
    light.position.set(...position);
    scene.add(light);
  }
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.85;
  controls.touches.ONE = null;
  controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
  let visible = false;
  let dirty = true;
  controls.addEventListener('change', () => { dirty = true; });
  let model;
  let hazards;
  let hazardOn;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let environment;
  {
    const room = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    environment = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    scene.environment = environment.texture;
    scene.children.filter(object => object.isLight).forEach(light => {
      light.intensity *= 0.4;
    });
  }
  function reset() {
    if (!model) return;
    const bounds = new THREE.Box3().setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3());
    const radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;
    const vertical = THREE.MathUtils.degToRad(camera.fov / 2);
    const angle = Math.min(vertical, Math.atan(Math.tan(vertical) * camera.aspect));
    const framing = { obd: 0.95, vehicleSim: 1.06, serviceEquipment: 0.92 };
    const distance = radius / Math.sin(angle) * (framing[key] ?? 0.78);
    controls.target.copy(center);
    const direction = key === 'vehicleSim' ? new THREE.Vector3(1.1, 1.03, -1.4)
      : new THREE.Vector3(1.1, 0.65, key === 'vehicle' ? -1.4 : 1.4);
    camera.position.copy(center).add(direction.normalize().multiplyScalar(distance));
    controls.minDistance = distance * 0.5;
    controls.maxDistance = distance * 2;
    controls.update();
  }
  viewport.addEventListener('keydown', event => {
    if (event.target !== viewport || !model) return;
    const offset = camera.position.clone().sub(controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    const directions = { ArrowLeft: [-0.15, 0], ArrowRight: [0.15, 0], ArrowUp: [0, -0.15], ArrowDown: [0, 0.15] };
    if (directions[event.key]) {
      event.preventDefault();
      spherical.theta += directions[event.key][0];
      spherical.phi = THREE.MathUtils.clamp(spherical.phi + directions[event.key][1], 0.1, controls.maxPolarAngle);
    } else if (['+', '=', '-'].includes(event.key)) {
      event.preventDefault();
      spherical.radius = THREE.MathUtils.clamp(spherical.radius * (event.key === '-' ? 1.1 : 0.9), controls.minDistance, controls.maxDistance);
    } else return;
    camera.position.copy(controls.target).add(offset.setFromSpherical(spherical));
    controls.update();
  });
  new ResizeObserver(() => {
    renderer.setSize(viewport.clientWidth, viewport.clientHeight);
    camera.aspect = viewport.clientWidth / viewport.clientHeight;
    camera.updateProjectionMatrix();
    dirty = true;
    reset();
  }).observe(viewport);
  new IntersectionObserver(entries => { visible = entries[0].isIntersecting; dirty = true; }).observe(viewport);
  renderer.setAnimationLoop(time => {
    if (!visible || document.hidden) {
      return;
    }
    controls.update();
    if (hazards) {
      const on = reducedMotion.matches || Math.floor(time / 500) % 2 === 0;
      if (on !== hazardOn) {
        hazardOn = on;
        hazards.emissiveIntensity = on ? 10 : 0;
        hazards.opacity = on ? 1 : 0;
        viewport.dataset.hazardsOn = String(on);
        dirty = true;
      }
    }
    if (dirty) {
      renderer.render(scene, camera);
      dirty = false;
    }
  });
  renderer.domElement.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    statusKey = 'restore';
    translate();
  });
  if (key === 'maintenance') {
    model = new THREE.Group();
    const vehicles = await Promise.all(['sports-car', 'fleet-car', 'bus', 'fleet-truck'].map(getModel));
    vehicles.forEach((root, index) => {
      const vehicle = normalize(root, index >= 2 ? 3.4 : 2.6);
      if (index === 0) vehicle.rotation.y = Math.PI;
      vehicle.position.set((index % 2 - 0.5) * 2.3, 0, (Math.floor(index / 2) - 0.5) * 3.7);
      vehicle.userData.fleetAsset = ['sports-car', 'fleet-car', 'bus', 'fleet-truck'][index];
      model.add(vehicle);
    });
    viewport.dataset.vehicleCount = String(vehicles.length);
  } else if (key === 'serviceEquipment') {
    model = await serviceBay(viewport);
  } else {
    const files = { vehicle: 'sports-car-rich', powertrain: 'chassis', gearbox: 'gearbox', commercial: 'commercial-fleet',
      obd: 'obd-diagnostics', vehicleSim: 'vehicle-test-cell' };
    model = normalize(await getModel(files[key]), 4);
  }
  if (key === 'commercial') {
    let count = 0;
    model.traverse(object => { if (object.isMesh) count++; });
    viewport.dataset.vehicleCount = String(count);
    let blueBus;
    model.traverse(object => { if (object.isMesh && object.name.includes('blue')) blueBus = object; });
    const lighting = addBusLights(blueBus);
    hazards = lighting.hazards;
    viewport.dataset.headlights = 'on';
    viewport.dataset.daytimeLights = 'on';
    viewport.dataset.positionLights = 'front-rear';
    viewport.dataset.lightingVehicle = 'blue';
    viewport.dataset.sideMarkerCount = String(lighting.sideMarkerCount);
  }
  if (key === 'vehicle') {
    viewport.dataset.quality = 'rich';
    model.traverse(object => {
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material?.name === 'Body.002') material.color.setHex(0xb4c4cc);
      }
    });
  }
  scene.add(model);
  dirty = true;
  reset();
  status.textContent = '';
  viewport.dataset.loaded = key;
  viewport.setAttribute('aria-busy', 'false');
  statusKey = '';
  translate();
}

function mountView(viewport) {
  createView(viewport).catch(error => {
    const showError = () => { viewport.querySelector('.model-status').textContent = t('unavailable'); };
    showError();
    document.addEventListener('languagechange', showError);
    viewport.setAttribute('aria-busy', 'false');
    console.error('Card model unavailable:', error);
  });
}

const lazyScenes = new Set(['vehicleSim', 'serviceEquipment']);
const nearViewport = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    nearViewport.unobserve(entry.target);
    mountView(entry.target);
  }
}, { rootMargin: '160px' });
for (const viewport of document.querySelectorAll('.card-model')) {
  if (lazyScenes.has(viewport.dataset.scene)) nearViewport.observe(viewport);
  else mountView(viewport);
}
