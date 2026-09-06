/**
 * Non-invasive, client-side browser device detector.
 * Reads publicly accessible WebGL and screen attributes to help auto-fill hardware rig specs.
 */

export const detectCurrentDevice = () => {
  const result = {
    deviceType: 'PC',
    rigName: 'My Gaming Rig',
    specs: {
      cpu: '',
      gpu: '',
      ram: '',
      monitor: '',
      peripherals: ''
    }
  };

  try {
    // 1. Detect OS & Platform
    const ua = navigator.userAgent || '';
    let os = 'PC';
    let isMobile = false;
    let isLaptop = false;

    if (/iPhone|iPad|iPod/i.test(ua)) {
      os = 'iOS';
      isMobile = true;
    } else if (/Android/i.test(ua)) {
      os = 'Android';
      isMobile = true;
    } else if (/Macintosh|Mac OS X/i.test(ua)) {
      os = 'macOS';
      isLaptop = true;
    } else if (/Windows/i.test(ua)) {
      os = 'Windows';
    } else if (/Linux/i.test(ua)) {
      os = 'Linux';
    }

    if (isMobile) {
      result.deviceType = 'Mobile';
      result.rigName = `Mobile Setup (${os})`;
    } else if (isLaptop) {
      result.deviceType = 'Laptop';
      result.rigName = `Gaming Laptop (${os})`;
    } else {
      result.deviceType = 'PC';
      result.rigName = `Battle Station (${os})`;
    }

    // 2. Detect CPU Cores & Memory (Coarse hints)
    const cores = navigator.hardwareConcurrency;
    const memory = navigator.deviceMemory; // in GB, Chrome only
    if (cores) {
      result.specs.cpu = `${cores} Cores (${os})`;
    }
    if (memory) {
      result.specs.ram = `${memory} GB+`;
    }

    // 3. Detect Screen / Display (Accounting for OS DPI Scaling e.g. 125%, 150%)
    const dpr = window.devicePixelRatio || 1;
    const rawWidth = window.screen?.width || 0;
    const rawHeight = window.screen?.height || 0;
    const physWidth = Math.round(rawWidth * dpr);
    const physHeight = Math.round(rawHeight * dpr);

    if (physWidth && physHeight) {
      // Common standard tags
      let resLabel = `${physWidth}x${physHeight}`;
      if (physWidth === 1920 && physHeight === 1080) resLabel = '1920x1080 (1080p FHD)';
      else if (physWidth === 2560 && physHeight === 1440) resLabel = '2560x1440 (1440p QHD)';
      else if (physWidth === 3840 && physHeight === 2160) resLabel = '3840x2160 (4K UHD)';
      else if (physWidth === 3440 && physHeight === 1440) resLabel = '3440x1440 (Ultrawide)';

      result.specs.monitor = resLabel;
    }

    // 4. Detect GPU via WebGL Renderer
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl) {
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        let renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '';
        // Clean up common prefixes like "ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0, D3D11)"
        renderer = renderer
          .replace(/ANGLE \((.*?), (.*?), (.*?)\)/i, '$2')
          .replace(/Direct3D.*?$/i, '')
          .replace(/\(R\)|\(TM\)/g, '')
          .trim();
        if (renderer) {
          result.specs.gpu = renderer;
        }
      }
    }
  } catch (err) {
    console.warn('[DeviceDetector] Auto-detect error fallback:', err);
  }

  return result;
};
