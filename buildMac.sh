#!/bin/bash
echo '----- Packaging 45drives-setup-wizard for MacOS! Please wait... -----'

start_time=$(date +%s)
fullVersionString="1.0.0"
appVersion="1.0.0"

echo "Build Version: $appVersion"

appType=app-image
appName=45drives-setup-wizard
appIcon=icon.ico

outputDir=dist/mac
entitlementsFile=entitlements.mac.plist

developerID=CNDSVW45N4
developerIdApplicationString="Developer ID Application: Protocase Incorporated ($developerID)"
developerAppPassword=umth-oikr-xdlc-zrrw

echo '----- BUILD APP -----'
yarn build:mac
echo '.....DONE.'

echo '----- CODE SIGNING APP -----'
## Find all files and do deep code signing.
find $outputDir/$appName.app -type f -exec codesign --deep -dvv --force --timestamp --options=runtime --entitlements $entitlementsFile --sign "$developerIdApplicationString" {} \;
## Code sign .app bundle
codesign --deep -dvv --force --timestamp --options=runtime --entitlements $entitlementsFile --sign "$developerIdApplicationString" $outputDir/$appName.app
## Verify code signing was successful.
codesign --verify --strict -dvv $outputDir/$appName.app
echo '.....DONE.'

## Create a temp directory to add the symbolic link to the applications folder
mkdir $outputDir/temp
cp -R $outputDir/$appName.app $outputDir/temp
ln -s /Applications $outputDir/temp/Applications

echo '----- CREATING DMG -----'
hdiutil create -volname "$appName" -srcfolder $outputDir/temp -ov -fs HFS+ -format UDZO -imagekey zlib-level=9 -o $outputDir/$appName.dmg
echo '.....DONE.'

echo '----- CODE SIGNING DMG -----'
codesign --deep -dvv --force --timestamp --options=runtime --entitlements $entitlementsFile --sign "$developerIdApplicationString" $outputDir/$appName.dmg
codesign --verify -dvv jdesigner-client/build/jpackage/output/$appName.dmg
echo '.....DONE.'

echo '----- NOTARIZING APP -----'
xcrun notarytool submit "$outputDir/$appName.dmg" --apple-id cduffney@protocase.com --team-id $developerID --password $developerAppPassword --wait
xcrun stapler staple "$outputDir/$appName.dmg"
#echo '.....DONE.'

## IF NOTARIZATION FAILS, RUN THE BELOW COMMAND WITH THE SUBMISSION ID TO VIEW LOGS.
#xcrun notarytool log <submissionID> --apple-id cduffney@protocase.com --team-id CNDSVW45N4 --password umth-oikr-xdlc-zrrw

end_time=$(date +%s)
elapsed_time=$(( end_time - start_time ))
minutes=$(( elapsed_time / 60 ))
seconds=$(( elapsed_time % 60 ))

echo "--------------------------------------------------------"
echo "Elapsed time: ${minutes} minutes and ${seconds} seconds!"
echo "--------------------------------------------------------"
