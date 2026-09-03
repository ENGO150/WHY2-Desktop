/*
This is part of WHY2
Copyright (C) 2026 Václav Šmejkal

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

//THE MARK index.html STOOD UP WHILE THIS WAS STILL ON ITS WAY, AND HOW LONG IT IS LOOKED AT IS NOT THE
//SAME QUESTION ON THE TWO PLATFORMS: A PHONE SPENDS SECONDS ON THE BUNDLE, AND A DESKTOP A FEW
//MILLISECONDS - LONG ENOUGH TO BE A FLICKER AND NOT LONG ENOUGH TO BE A LOGO. SO IT IS GIVEN A FLOOR
//MEASURED FROM THE PAGE'S OWN START (performance.now() IS EXACTLY THAT), WHICH ON A PHONE HAS ALREADY
//PASSED AND COSTS NOTHING, AND ON A DESKTOP IS THE WHOLE OF WHAT MAKES THE PROGRAM OPEN ON ITS NAME
const BOOT_MS = 600;   //HOW LONG THE MARK IS UP, AT THE LEAST
const FADE_MS = 250;   //AND THE TRANSITION IN index.html IT LEAVES BY

const boot = document.getElementById("boot");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);

//IT STANDS OVER THE WINDOW RATHER THAN INSIDE IT, SO TAKING IT DOWN IS THIS AND NOTHING ELSE
if (boot)
{
    setTimeout(() =>
    {
        boot.classList.add("gone");
        setTimeout(() => boot.remove(), FADE_MS);
    }, Math.max(0, BOOT_MS - performance.now()));
}
