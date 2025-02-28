# Automatic Houston Plugin Makefile
# Copyright (C) 2022 Josh Boudreau <jboudreau@45drives.com>
# 
# Automatic Houston Plugin Makefile is free software: you can redistribute it and/or modify it under the terms
# of the GNU General Public License as published by the Free Software Foundation, either version 3
# of the License, or (at your option) any later version.
# 
# Automatic Houston Plugin Makefile is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
# without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
# GNU General Public License for more details.
# 
# You should have received a copy of the GNU General Public License along with Automatic Houston Plugin Makefile.
# If not, see <https://www.gnu.org/licenses/>. 


# USAGE
# installation:
# $ make
# # make install
# testing:
# $ make
# $ make install-local
# or
# $ make install-remote
################################
# Do not edit anything below

define greentext
	'\033[1;32m$(1)\033[0m'
endef
define cyantext
	'\033[1;96m$(1)\033[0m'
endef

ifeq ($(DEBUG),1)
BUILD_FLAGS=-- --minify false
endif

default: houston-common

all: default

.PHONY: default all install clean help install-local install-remote install houston-common

houston-common/Makefile:
	git submodule update --init

houston-common: houston-common/Makefile
	$(MAKE) -C houston-common
	npm install

houston-common-%:
	$(MAKE) -C houston-common $*

FORCE:
