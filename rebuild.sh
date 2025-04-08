#!/bin/bash
set -x
# set -e

echo "node version"
node --version
echo "npm version"
npm --version

rm -rf node_modules
rm package-lock.json
rm yarn.lock
rm -rf build
rm -rf houston-common/houston-common-lib/node_modules
rm -rf houston-common/houston-common-lib/package-lock.json
rm -rf houston-common/houston-common-lib/yarn.lock
rm -rf houston-common/houston-common-lib/dist
rm -rf houston-common/houston-common-ui/node_modules
rm -rf houston-common/houston-common-ui/package-lock.json
rm -rf houston-common/houston-common-ui/yarn.lock
rm -rf houston-common/houston-common-ui/dist


yarn install
