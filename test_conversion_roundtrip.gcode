; Test gcode for .3w conversion validation
; Simple test file to verify encryption and wrapping

G28 ; Home all axes
G1 Z5 F300 ; Lift nozzle
G1 X10 Y10 F3000 ; Move to start position
M104 S200 ; Set hotend temp
M140 S60 ; Set bed temp
M109 S200 ; Wait for hotend
M190 S60 ; Wait for bed
G92 E0 ; Reset extruder
G1 F200 E5 ; Purge nozzle
G92 E0 ; Reset extruder
G1 F3000 ; Set movement speed
; End of test
