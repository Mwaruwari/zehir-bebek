import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

async function generateIcons() {
  const source = 'public/logo.jpg';
  
  if (!fs.existsSync(source)) {
    console.error(`Source file ${source} does not exist!`);
    process.exit(1);
  }

  const targets = [
    { name: 'apple-touch-icon.png', size: 180 },
    { name: 'favicon-32x32.png', size: 32 },
    { name: 'favicon-512x512.png', size: 512 }
  ];

  console.log('Starting icon generation from', source);

  for (const target of targets) {
    const destPath = path.join('public', target.name);
    try {
      await sharp(source)
        .resize(target.size, target.size)
        .png()
        .toFile(destPath);
      
      const stats = fs.statSync(destPath);
      console.log(`Generated ${destPath} (${target.size}x${target.size}) - Size: ${stats.size} bytes`);
    } catch (err) {
      console.error(`Error generating ${target.name}:`, err.message);
    }
  }
}

generateIcons();
