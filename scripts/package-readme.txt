Project Translate {VERSION}

Translate Project Zomboid B42 mods and the base game, then build an
installable translation mod.

HOW TO RUN
  Double-click "Start Project Translate.cmd".
  Your browser opens at http://127.0.0.1:3100
  Close the black console window to stop the tool.

ABOUT THE .EXE IN THIS FOLDER
  runtime\node.exe is the official Node.js runtime ({NODE_VERSION}), the
  program that runs this tool. It is the unmodified file from nodejs.org,
  digitally signed by the OpenJS Foundation and counter-signed by Microsoft.

  You can check that yourself. Right-click runtime\node.exe, choose
  Properties, then the "Digital Signatures" tab. It must say
  "OpenJS Foundation".

  Nothing here is packed, obfuscated or downloaded at run time. The start
  file is plain text - open it in Notepad and read it.

  CHECKSUMS.txt lists the SHA-256 hashes of the files that matter, with
  instructions for verifying them.

NOTHING TO INSTALL
  Everything is in this folder. Nothing is written outside it, no registry
  entries, no administrator rights.

YOUR FILES
  config.json      your settings (created on first start)
  export\work      your translations
  export\mods      the translation mods you build
  export\backups   restore points

  Keep this folder when you update: copy in the new version and keep your
  config.json and your export folder.

GAME FOLDERS ARE READ-ONLY
  The tool only reads your Project Zomboid and Workshop folders. It never
  writes there. To use a translation, export it as a mod and install that.

REQUIREMENTS
  Windows, Project Zomboid B42.

SOURCE CODE
  {GITHUB}

Author: Latency404
License: MIT
