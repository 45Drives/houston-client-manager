#!/bin/bash
# set -x
set -e

echo "node version"
node --version
echo "npm version"
npm --version

rm -rf node_modules
rm package-lock.json
rm -rf build
rm -rf houston-common/houston-common-lib/node_modules
rm -rf houston-common/houston-common-lib/package-lock.json
rm -rf houston-common/houston-common-ui/node_modules
rm -rf houston-common/houston-common-ui/package-lock.json

echo 'Building houston-common-lib...'
cd houston-common/houston-common-lib/ || exit
npm install
npm run build
cd ../../

echo 'Building houston-common-ui...'
cd houston-common/houston-common-ui/ || exit
npm install
npm run build
cd ../../

npm install
