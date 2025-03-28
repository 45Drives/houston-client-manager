const { existsSync, renameSync } = require('fs');
const { join } = require('path');

function fix_css(){
  const uiPath = join(process.cwd(), 'node_modules/@45drives/houston-common-ui/dist/');
  const indexCss = join(uiPath, 'index.css');
  const styleCss = join(uiPath, 'style.css');
  const targetCss = join(uiPath, 'style.css'); // Standardized file name
  
  if (existsSync(indexCss)) {
    renameSync(indexCss, targetCss);
  } else if (existsSync(styleCss)) {
    renameSync(styleCss, targetCss);
  }
}

module.exports = fix_css;