# ProdMesh: The extensible platform for Sundays

## Context
Churches tend to use the same tech stack amongst themselves

CORE:
- Planning Center Services for scheduling service times and runs of show, and coordinating volunteers
- Planning Center Calendar for scheduling rooms to services
- ProPresenter for displaying lyrics, playing back videos, displaying sermon notes
- Bitfocus Companion for manging room integration (ATEM + Lighting + Screens + PA + Power + routing + etc)

EXTRA:
- SMAART for analyzing the room's average and peak loudness and keeping them within parameters set by pastors and elders (sometimes this changes depending on event, i.e. our Sundays target 90db not to exceed 95db, our Nights of worship target 95-100db not to exceed 105db
- Shure wireless systems (i.e. Axient)
- Resi for cross-site streaming
- Youtube or Facebook for live streaming (many times via a Blackmagic Web Presenter)
- ProdCom (real time communications transcriptions between worship back line members, Music Director, drummer, FOH engineer etc)
- Slack alerts for events in the room (Startup, shutdown, connectivity issues etc)

These all live in separate worlds, nothing captures or coordinates what's happening on Sundays and there is no "at a glance" tool for managing all of the info. Additionally the resilience that people expect in the Software/Cloud world is non-existent in the production world, with next to no real-time monitoring or preemptive alarming when things go out of bound.

## Vision

Enter ProdMesh. ProdMesh is a multi-site capable system, with a server running at each site but a single pane of glass that anyone on the production team can use to inspect what's going on and track/control services and the rooms that are powering them with minimal training. Features:

### Room Startup Procedures
ProdMesh gives the ability to begin starting a room for a specific type of event in a single click. Each room and event type has a checklist that must be executed (with some automated items i.e. trigger a button in bitfocus companion, and some manual items). Manual items might include:
- Install batteries in mobile cameras
- Place run of show sheets at all tech positions
- Place sermon notes in the PCR
- Manually turn on specific cameras
- Ensure all mic and IEM packs are charged
- Start ProTools session for Live Stream Broadcast audio

The items should be configurable by room + event type. 

### Run of Show Dashboard
Give your entire team a real-time view of the service so everyone stays aligned from start to finish.

POWERFUL INTEGRATIONS
Bring every tool together
Everything your team relies on, connected in one dashboard where is all works together.

FLEXIBLE OUTPUTS
Dashboards for every screen
Display dashboards on TVs, tablets, desktops, mobile devices, and more.

LIVE COMMAND CENTER
Your entire operation in one view
See every service, location, and connected tool from one command center.

A dashboard for every role
Drag, resize, and arrange live widgets into custom dashboards for every role on your team. Everyone gets exactly the information they need—nothing they don't.

All your tools in one place
Bring Planning Center, ProPresenter, SMAART, Resi, ProdCom, livestream analytics, gear assignments, notes, and more into one customizable workspace.

Auto-track your service
Run ProPresenter like you always have. Select a ProPresenter timer to display in your Dashboard or use as your Service Start timer. As your operator advances through slides, ProdMesh automatically tracks every Planning Center item in real time. 

Know exactly how Sunday went
As your team runs the service, ProdMesh automatically captures timing, SPL, livestream analytics, and every service element—giving you a complete report the moment your s

Keep everyone on the same page
PER SERVICE (not per time): Create shared notes, build checklists, and track task completion in real time so your team stays aligned from rehearsal to teardown.

Control more than your dashboard
Bring live video into your dashboard with NDI and RTMP.

Large-format Displays
Build dashboards with KPIs to show in the multiview of a switcher, or on a Stage/Presenter Display.  

### Reporting Dashboards
See trends in SPL, Timing, and service length (partitioned by service type) over 30/60/90D time periods.

### User Management
Multi-user. Needs to be usable in multiple locations at once without data corruption and with different levels of access.
