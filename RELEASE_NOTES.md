# GivHome 4.1.0 — Emergency Stop and Solar-Aware Cheap Overnight

More control when you need it. More room for tomorrow’s sunshine.

4.1.0 brings Emergency Stop and Solar-Aware Cheap Overnight into Apple Home, alongside clearer controls and better continuity between battery actions.

## Emergency Stop — back to normal

If your battery is charging or exporting unexpectedly, Emergency Stop gives you a simple way to stop the current action from Apple Home.

GivHome finds, then clears the schedule associated with that action, returns the battery to normal Eco operation and checks that the stop has taken effect. Eligible future schedules remain in place. Once the stop is confirmed, you can start a new action whenever you’re ready.

If communication is interrupted, GivHome keeps track of what still needs to be completed, including after a restart. Apple Home shows a fault if GivHome cannot confirm the result.

The Emergency Stop tile is available by default on supported systems with battery control enabled. You can hide it in Plugin Config.

## Solar-Aware Cheap Overnight — leave room for tomorrow

A dull day may call for more cheap overnight energy. A brighter day may give the battery another chance to fill from your own panels.

Solar-Aware Cheap Overnight uses tomorrow’s Predicted Solar forecast to choose between three overnight battery levels you set: one for a low-solar day, one for a middle band and one for a high-solar day. You also define the forecast boundaries that determine whether tomorrow is classified as low, medium or high solar.

The Apple Home switch lets you use those choices or return to your normal Night Target. Your normal target remains the maximum, and GivHome uses it whenever a suitable forecast is unavailable. Intelligent Octopus Go protection keeps its own separate target.

You choose how much room to leave. GivHome takes care of applying the right overnight level.

Solar-Aware Cheap Overnight is optional and needs Cheap Overnight and Predicted Solar configured.

Solar 2mrw now calculates its display scale from the combined capacity of all the solar arrays entered during setup. Each array’s direction, tilt and shading still shape its individual forecast. GivHome checks tomorrow’s forecast every 90 minutes, leaving fewer settings for you to manage.

## Local Learning — preparing for what comes next

Local Learning begins building a picture of your home’s energy use, solar generation and charging response from readings and forecasts GivHome already receives.

Learning is enabled by default. Its observations stay on your Homebridge device, with bounded storage and no learning history sent to the developer. You can switch it off in Plugin Config without changing your charging controls.

This prepares the ground for future Automatic Solar-Aware Cheap Overnight. Local Learning does not yet calculate or change charging targets.

## Clearer choices in Apple Home

**Night Target** gives the Cheap Overnight percentage slider, previously Charge Target, a shorter, clearer name that fits its tile. Your saved percentage is retained, and Plugin Config explains exactly which charging it affects.

**Octopus Flux Export** now has separate choices to enable the function and show its Flux Out tile. With the tile shown, you can turn Flux export off or back on in Apple Home. Hiding the tile leaves the enabled function following its configured rules. After a Homebridge restart, Flux follows the enabled configuration again.

Plugin Config has been reorganised and rewritten to make setup clearer, with related choices kept together and simpler explanations throughout.

## Smoother handovers between actions

Improved action ownership means GivHome restores only the settings its own action borrowed and preserves newer changes made elsewhere. Interrupted cleanup can continue after communication returns or Homebridge restarts.

Cheap Overnight retains priority during its own period, with enabled IOG protection able to take over afterwards.

Existing settings, Apple Home accessories, Eve history, control state and Local Learning data are carried forward when you upgrade. Explicitly saved disabled settings remain respected. GivHome also has an updated plugin logo.

Existing compatibility and control safeguards continue to apply. HR242 remains diagnostic-only.

**Full Changelog comparison:** [v4.0.2...v4.1.0](https://github.com/KernowekConsulting/homebridge-giv-iog-local/compare/v4.0.2...v4.1.0).
