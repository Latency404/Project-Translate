Project Translate {VERSION}

Translate Project Zomboid B42 mods and the base game, then build an
installable translation mod.

THIS IS A PROGRAM, NOT A GAMEPLAY MOD
  Subscribing does not change anything in the game. The Workshop is only
  used to deliver the files. You do not need to enable it in the mod list.

WHAT YOU NEED
  Node.js 22.2 or newer. It is free: install the LTS version from
  https://nodejs.org (no administrator rights needed for a per-user install).
  The Workshop does not allow .exe files, so Node is not included here.

  Do not want to install anything? The GitHub releases page has a
  self-contained version with Node included:
  {GITHUB}/releases

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

WHAT IS IN THIS FOLDER
  Nothing is packed, obfuscated, or downloaded while it runs. The start file
  is plain text - open it in Notepad and read every line.

  The tool serves a small web page on 127.0.0.1 so you can use your browser
  as its window. That address is your own machine only; nothing is reachable
  from the network and nothing is sent anywhere.

WHY COPY IT OUT FIRST
  Your settings and translations are stored next to the start file. If you
  leave the folder where Steam put it, a Workshop update can wipe them.

GAME FOLDERS ARE READ-ONLY
  The tool only reads your Project Zomboid and Workshop folders. It never
  writes there. To use a translation, export it as a mod and install that.

SOURCE CODE, ISSUES, NEWER VERSIONS
  {GITHUB}

Author: Latency404
License: MIT
