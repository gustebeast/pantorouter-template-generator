@echo off
REM Double-click to open this project's assembly.step in the FreeCAD viewer hub.
REM All logic lives in the vendored launcher (cadkit subtree); this forwards our folder.
call "%~dp0cadkitreecadiew_assembly.cmd" "%~dp0"
