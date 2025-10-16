const fs = require('fs');
const path = require('path');

const pkgRoot = path.join(
  __dirname,
  '..',
  'node_modules',
  '@scottjgilroy',
  'react-native-vision-camera-v4-pose-detection'
);

const sourceSpec = path.join(
  pkgRoot,
  'react-native-vision-camera-v3-pose-detection.podspec'
);
const targetSpec = path.join(
  pkgRoot,
  'react-native-vision-camera-v4-pose-detection.podspec'
);

function ensurePodspecExists() {
  if (!fs.existsSync(pkgRoot)) {
    return;
  }

  if (!fs.existsSync(sourceSpec)) {
    return;
  }

  if (!fs.existsSync(targetSpec)) {
    fs.copyFileSync(sourceSpec, targetSpec);
  }

  [sourceSpec, targetSpec].forEach((specPath) => {
    if (!fs.existsSync(specPath)) {
      return;
    }
    const original = fs.readFileSync(specPath, 'utf8');
    const updated = original.replace(
      /^\s*s\.dependency\s+"RCT-Folly"\s*$/m,
      ''
    );
    if (original !== updated) {
      fs.writeFileSync(specPath, updated, 'utf8');
    }
  });
}

ensurePodspecExists();
