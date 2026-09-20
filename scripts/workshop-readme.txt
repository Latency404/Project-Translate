Project Translate {VERSION}

Translate Project Zomboid B42 mods and the base game, then build an
installable translation mod.

THIS IS A PROGRAM, NOT A GAMEPLAY MOD
  Subscribing does not change anything in the game. The Workshop is only
  used to deliver the files. You do not need to enable it in the mod list.

HOW TO RUN
  1. Find this folder. In Steam, right-click Project Zomboid, choose
     Manage, then Browse local files. Go up until you reach the
     steamapps folder, then open:
       steamapps\workshop\content\108600\
     Look for the folder that contains mods\ProjectTranslate.
  2. Copy that whole folder somewhere else, for example your Desktop.
     Steam overwrites its own copy on every update.
  3. Double-click "Start Project Translate.cmd".
     Your browser opens at http://127.0.0.1:3100
     Close the console window to stop it.

ABOUT THE .EXE IN THIS FOLDER
  Yes, there is an .exe here, and you should be suspicious of those. Here
  is exactly what it is.

  runtime\node.exe is the official Node.js runtime ({NODE_VERSION}) - the
  program that runs this tool. It is the unmodified file from nodejs.org,
  digitally signed by the OpenJS Foundation and counter-signed by Microsoft.
  It is not something I built or packed.

  Check it yourself: right-click runtime\node.exe, choose Properties, then
  the "Digital Signatures" tab. It must say "OpenJS Foundation".

  Nothing is packed, obfuscated, or downloaded while it runs. The start file
  is plain text - open it in Notepad and read every line. CHECKSUMS.txt
  lists SHA-256 hashes with instructions for verifying them.

  The tool serves a small web page on 127.0.0.1 so you can use your browser
  as its window. That address is your own machine only; nothing is reachable
  from the network and nothing is sent anywhere.

WHY COPY IT OUT FIRST
  Your settings and translations are stored next to the start file. If you
  leave the folder where Steam put it, a Workshop update can wipe them.

NOTHING TO INSTALL
  The Node runtime is included. Nothing is written outside the folder, no
  registry entries, no administrator rights.

GAME FOLDERS ARE READ-ONLY
  The tool only reads your Project Zomboid and Workshop folders. It never
  writes there. To use a translation, export it as a mod and install that.

SOURCE CODE, ISSUES, NEWER VERSIONS
  {GITHUB}

Author: Latency404
License: MIT
