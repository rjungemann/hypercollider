// HyperCollider HCNetAddrZeroconf.sc
// mDNS/Bonjour service discovery support for NetAddr
// Phase B2: sclang-side browsing

+ NetAddr {
	classvar <zeroconfServices;

	*initClass {
		zeroconfServices = Dictionary.new;
	}

	*_zeroconfFound { |name, host, port|
		var addr = NetAddr(host, port);
		zeroconfServices.put(name.asSymbol, addr);
		this.changed(\serviceFound, name, addr);
		// If a server is registered with this name, update its address automatically
		Server.all.do { |srv|
			if (srv.name.asString == name) { srv.addr = addr }
		};
		("mDNS: found " ++ name ++ " at " ++ host ++ ":" ++ port).postln;
	}

	*_zeroconfLost { |name|
		zeroconfServices.removeAt(name.asSymbol);
		this.changed(\serviceLost, name);
		("mDNS: lost " ++ name).postln;
	}

	*findServiceNamed { |name, action|
		// Synchronous: return current address if already known
		var existing = zeroconfServices.at(name.asSymbol);
		if (existing.notNil) { action.value(existing); ^existing };
		// Async: wait for the next serviceFound notification
		this.addDependant({ |changer, what, svcName, addr|
			if (what == \serviceFound and: { svcName == name }) {
				action.value(addr);
				this.removeDependant(thisFunction);
			}
		});
		^nil
	}
}
