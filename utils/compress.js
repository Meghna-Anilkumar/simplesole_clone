let imagemin, imageminMozjpeg, imageminPngquant, imageminSvgo;

(async () => {
  const { default: imageminModule } = await import('imagemin');
  const { default: mozjpeg } = await import('imagemin-mozjpeg');
  const { default: pngquant } = await import('imagemin-pngquant');
  const { default: svgo } = await import('imagemin-svgo');

  imagemin = imageminModule;
  imageminMozjpeg = mozjpeg;
  imageminPngquant = pngquant;
  imageminSvgo = svgo;

})();

const compressImages = async (files) => {
  const inputDir = './uploads'; 
  const outputDir = './compressed_images'; 

  await imagemin(files.map(file => `${inputDir}/${file.filename}`), {
    destination: outputDir,
    plugins: [
      imageminMozjpeg({ quality: 80 }), 
      imageminPngquant({ quality: [0.6, 0.8] }), 
      imageminSvgo() 
    ]
  });
};

module.exports = {
  compressImages
};
