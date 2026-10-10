import * as THREE from 'three';

export function addBusLights(bus) {
  const atlas = bus.material.map;
  // UV locations on the source bus's 1024px atlas. The masks follow the native
  // lenses on the existing body geometry, including its sloping front panels.
  function mask(paint) {
    const canvas = document.createElement('canvas');
    canvas.width = atlas.image.width;
    canvas.height = atlas.image.height;
    const context = canvas.getContext('2d');
    context.scale(canvas.width / 1024, canvas.height / 1024);
    context.fillStyle = '#fff';
    paint(context);
    const texture = new THREE.CanvasTexture(canvas);
    texture.flipY = atlas.flipY;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }
  function lens(context, x, y, radius) {
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }
  const sideMarkers = [
    [171, 22], [362, 22], [561, 22], [674, 22], [797, 22], [935, 22],
    [48, 589], [171, 589], [305, 589], [417, 589],
    [561, 589], [674, 589], [797, 589], [935, 589],
  ];
  bus.material = bus.material.clone();
  bus.material.emissiveMap = mask(context => {
    context.fillStyle = '#fff1d6';
    lens(context, 45, 843, 5.5);
    lens(context, 245, 843, 5.5);
    // Soft white running/position lamps in the additional front lenses.
    context.fillStyle = '#7997a3';
    lens(context, 25, 844, 3.5);
    lens(context, 263, 843, 3.5);
    // Red rear position lamps, separate from the flashing indicators.
    context.fillStyle = '#d7190d';
    for (const x of [287, 515]) {
      lens(context, x, 767, 3.5);
      lens(context, x, 819, 3.5);
    }
    context.fillStyle = '#ff5c00';
    for (const [x, y] of sideMarkers) context.fillRect(x - 5, y - 2, 10, 4);
  });
  bus.material.emissive.setHex(0xffffff);
  bus.material.emissiveIntensity = 3;
  const amber = mask(context => {
    function frontIndicator(x, y) {
      const glow = context.createRadialGradient(x, y, 2.5, x, y, 7);
      glow.addColorStop(0, 'rgba(255,255,255,1)');
      glow.addColorStop(0.55, 'rgba(255,255,255,0.3)');
      glow.addColorStop(1, 'rgba(255,255,255,0)');
      context.fillStyle = glow;
      lens(context, x, y, 7);
      context.fillStyle = '#fff';
      lens(context, x, y, 2.5);
    }
    // The small outer grey lenses are indicators; the adjacent larger lamps
    // belong to the headlight cluster and must not flash.
    frontIndicator(15, 839);
    frontIndicator(273, 839);
    // Native round side repeaters, above the front position markers.
    lens(context, 28, 54, 2);
    lens(context, 28, 556, 2);
    lens(context, 287, 785, 3.5);
    lens(context, 515, 785, 3.5);
  });
  const hazards = new THREE.MeshStandardMaterial({
    map: amber, emissiveMap: amber, color: 0xff9900, emissive: 0xff4400,
    emissiveIntensity: 10, roughness: 0.3, toneMapped: false,
    // Transparent objects render after the source bus's transmissive material.
    transparent: true, alphaTest: 0.02, side: THREE.DoubleSide, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const lamps = new THREE.Mesh(bus.geometry, hazards);
  lamps.name = 'Native bus amber lamps';
  bus.add(lamps);
  return { hazards, sideMarkerCount: sideMarkers.length };
}
