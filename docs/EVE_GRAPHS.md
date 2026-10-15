# GivHome & Eve: Guide to Getting Graphs Working

Eve graphs let you see how your home's energy system has behaved over time, rather than just what it is doing right now.

For example, GivHome can show that your battery is currently at 85%. A historical graph can show how that battery level changed throughout the day.

With Eve, you can explore your energy history, spot patterns and better understand how your system performs.

## What you need

1. A GivEnergy inverter connected to your home network.
2. A Raspberry Pi or another computer running Homebridge.
3. GivHome Homebridge plugin v4.0.1 or later, with Eve history support.
4. An iPhone or iPad with Apple's Home app.
5. The free [Eve for Matter & HomeKit app](https://itunes.apple.com/app/elgato-eve/id917695792).

**You do not need to purchase any Eve hardware.**

## How everything connects

It's simple:

**GivEnergy inverter → GivHome Homebridge plugin → Apple Home → Eve app**

GivHome reads information from your inverter and makes it available through Homebridge.

Apple Home displays your accessories, while Eve lets you explore their historical data through graphs.

## Step 1 — Check Homebridge

You should already see your GivHome accessories in Apple Home.

If the accessories aren't visible, check that Homebridge and the GivHome plugin are running correctly before continuing.

## Step 2 — Install Eve

Download and install the free Eve app on your iPhone or iPad.

Open Eve and allow it to access your Apple Home.

Your existing HomeKit accessories should appear automatically.

**You don't need to pair your inverter with Eve separately.**

## Step 3 — Find your GivHome accessories

1. Open the **Eve** app.
2. Select **Rooms**.
3. Open the room containing your GivHome accessories. For example, **Yard**.
4. Scroll down to find **Eve Export History** or another GivHome history accessory.
5. Tap the accessory to explore its information.

The room name may differ depending on how you've organised your accessories in Apple Home.

## Step 4 — Explore your graphs

Once you've opened a history accessory:

1. Find the graph showing your recorded measurements.
2. Look beneath the graph for the **ⓘ information button**.
3. Tap it to explore the available graph options.
4. Select **Month** to see your history over a longer period.

You can explore other available periods to see how your system has performed.

**The longer your system collects data, the more useful your graphs become.**

Over time, you'll build up a clearer picture of your home's energy usage, battery behaviour and electricity export.

## Step 5 — Give your history time to grow

Historical graphs need recorded measurements.

If you've only recently installed GivHome or enabled Eve history, your graphs may initially contain very little information.

This is normal.

As GivHome continues collecting measurements, your graphs will become more informative.

## Troubleshooting

| Problem | What to check |
|---|---|
| GivHome accessories are missing | Check that Homebridge and the GivHome plugin are running. |
| Accessories appear, but there are no graphs | Check that your installed GivHome plugin version supports Eve history. |
| Graphs appear but are empty | Allow time for historical measurements to accumulate. |
| Graphs contain gaps | Check that your inverter and Homebridge have remained connected. |
| Graphs disappeared after an update | Check your plugin version and history settings before making changes. |

**Important:** Don't delete Homebridge accessories, reset Apple Home or clear accessory caches simply to make graphs appear. These actions can disrupt your existing setup.
